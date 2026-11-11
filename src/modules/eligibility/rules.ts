import { countryInAnyRegion, countryInRegion } from './regions.js'
import { achievableOverlapHours, OVERLAP_TOLERANCE_HOURS } from './timezone.js'
import type { Rule, RuleInput, RuleOutcome, HardConstraintKey, Region } from './types.js'
import { ALWAYS_HARD, RegionSchema } from './types.js'

/**
 * Rules are pure functions. The same set runs in stage 1 (over structured job
 * fields) and stage 3 (over extracted claims) — see docs/eligibility-spec.md.
 *
 * ASYMMETRY OF SILENCE. A rule returns `unknown` only when silence is genuinely
 * ambiguous, not merely absent:
 *
 *   - A remote job whose scope is unspecified IS ambiguous — "Remote" alone tells
 *     us nothing, and this is the case the product exists to handle.
 *   - An unstated authorization requirement is NOT evidence of one. Most postings
 *     never mention it. Returning `unknown` here would push nearly every job into
 *     needs_review and make the queue useless.
 *
 * When adding a rule, decide deliberately which kind of silence it faces.
 */

const pass = (): RuleOutcome => ({ kind: 'pass' })
const fail = (reason: string, quote?: string): RuleOutcome =>
  quote === undefined ? { kind: 'fail', reason } : { kind: 'fail', reason, quote }
const unknown = (question: string): RuleOutcome => ({ kind: 'unknown', question })

function isHard(input: RuleInput, key: HardConstraintKey): boolean {
  return ALWAYS_HARD.has(key) || input.profile.hardConstraints.has(key)
}

/**
 * Where the candidate may take a remote job (D8): the country they live in plus the
 * countries they selected. A selected region widens which region-scoped jobs they
 * accept; it does not make them resident in every country of it.
 */
function acceptableCountries(input: RuleInput): Set<string> {
  const selected = input.profile.allowedRegions.filter((r) => !RegionSchema.safeParse(r.toLowerCase()).success)
  return new Set([input.profile.country, ...selected].map((c) => c.toUpperCase()))
}

function selectedRegions(input: RuleInput): Region[] {
  return input.profile.allowedRegions.flatMap((r) => {
    const region = RegionSchema.safeParse(r.toLowerCase())
    return region.success ? [region.data] : []
  })
}

/** Countries where the candidate may work without sponsorship (D5: their own always counts). */
function authorizedCountries(input: RuleInput): Set<string> {
  return new Set([input.profile.country, ...input.profile.workAuthorizations.map((a) => a.country)].map((c) => c.toUpperCase()))
}

/** Location-line words for everywhere, and for each region. */
const EVERYWHERE = /\b(worldwide|global|globally|anywhere|international)\b/i
const REGION_WORDS: Readonly<Record<Exclude<Region, 'worldwide'>, RegExp>> = {
  latam: /\b(latam|latin america|south america|central america|americas|amer)\b/i,
  namer: /\b(namer|north america|americas|amer)\b/i,
  emea: /\b(emea|europe)\b/i,
  apac: /\b(apac|apj|asia)\b/i,
}
/** Location-line words that name no place: arrangements, not where. */
const NO_PLACE = /\b(remote|home[ -]based|office[ -]based|hybrid|on-?site|in-office|fully|full[ -]time|flexible|distributed)\b/gi
const COUNTRY_NAMES = ['en', 'es'].map((locale) => new Intl.DisplayNames([locale], { type: 'region' }))

/**
 * Whether the location line includes somewhere the candidate can work: everywhere, a region
 * they live in or selected, or one of their countries by name or ISO code.
 */
function lineIncludesCandidate(input: RuleInput, line: string): boolean {
  if (EVERYWHERE.test(line)) return true
  const countries = [...acceptableCountries(input)]
  const regions = new Set([...selectedRegions(input), ...RegionSchema.options.filter((r) => countries.some((c) => countryInRegion(c, r) === 'in'))])
  if ([...regions].some((r) => r !== 'worldwide' && REGION_WORDS[r].test(line))) return true
  const lower = line.toLowerCase()
  return countries.some((code) => new RegExp(`\\b${code}\\b`).test(line)
    || COUNTRY_NAMES.some((names) => { const name = names.of(code); return name !== undefined && name !== code && lower.includes(name.toLowerCase()) }))
}

const claimsWorldwide = (scope: RuleInput['claims']['remoteScope']): boolean =>
  scope.kind === 'worldwide' || (scope.kind === 'regions' && (scope.regions ?? []).includes('worldwide'))

/**
 * A worldwide claim the role's own words do not support (engine v5). Company wording ("We hire
 * globally", "a globally distributed company") and perks ("work from anywhere for up to 4 weeks
 * per year") read as the role's scope. The title and location line describe this role: a
 * worldwide quote from either stands. One from the description is contested when the location
 * line names only places outside where the candidate can work, or the posting states office work.
 * Contested is contradictory, so it is an open question, never a rejection.
 */
function contestedWorldwide(input: RuleInput): boolean {
  const scope = input.claims.remoteScope
  if (!claimsWorldwide(scope)) return false
  const line = input.job.locationText ?? ''
  if (scope.quote !== undefined && (line.includes(scope.quote) || input.job.title.includes(scope.quote))) return false
  if (lineIncludesCandidate(input, line)) return false
  const namesAPlace = /\p{L}/u.test(line.replace(NO_PLACE, ''))
  return namesAPlace || input.claims.onsite.kind === 'hybrid' || input.claims.onsite.kind === 'onsite'
}

function contestedQuestion(input: RuleInput): string {
  const said = `The posting says "${input.claims.remoteScope.quote ?? 'worldwide'}"`
  const line = input.job.locationText?.trim()
  return line
    ? `${said}, but it is listed in ${line}: it does not say the role is open where you are.`
    : `${said}, but also describes ${input.claims.onsite.kind} work: it does not say the role is open where you are.`
}

/** Whether the posting states a remote scope that includes somewhere the candidate can work. */
function fitsRemoteScope(input: RuleInput): boolean {
  const scope = input.claims.remoteScope
  if (claimsWorldwide(scope) && !contestedWorldwide(input)) return true
  const countries = acceptableCountries(input)
  if (scope.kind === 'countries') return (scope.countries ?? []).some((c) => countries.has(c.toUpperCase()))
  if (scope.kind !== 'regions') return false
  const regions = (scope.regions ?? []).filter((r) => r !== 'worldwide')
  return regions.some((r) => selectedRegions(input).includes(r))
    || [...countries].some((c) => countryInAnyRegion(c, regions) === 'in')
}

/**
 * The arrangement the text states, falling back to the structured field. A remote scope
 * the candidate fits outranks offices listed beside it (engine v2): "Home Based - Americas;
 * Office Based - Beijing" is a remote role with optional offices, not a hybrid one.
 */
function workplace(input: RuleInput): 'onsite' | 'hybrid' | 'remote' | 'unknown' {
  if (fitsRemoteScope(input)) return 'remote'
  return input.claims.onsite.kind !== 'unspecified' ? input.claims.onsite.kind : input.job.locationPolicy
}

/** Where an onsite or hybrid role is: the countries the text names, else the structured one. */
function workplaceCountries(input: RuleInput): string[] {
  const named = input.claims.onsite.countries ?? []
  if (named.length > 0) return named.map((c) => c.toUpperCase())
  return input.job.locationCountry === null ? [] : [input.job.locationCountry.toUpperCase()]
}

const onsiteRequiresRelocation: Rule = {
  id: 'onsite-requires-relocation',
  appliesWhen: (i) => isHard(i, 'relocation'),
  evaluate: (i) => {
    const policy = workplace(i)
    if (policy === 'remote') return pass()
    if (policy === 'unknown') {
      return unknown('The posting does not say whether the role is remote or onsite.')
    }
    const countries = workplaceCountries(i)
    if (countries.length === 0) {
      return unknown('The role is not fully remote but the posting gives no location.')
    }
    if (countries.includes(i.profile.country.toUpperCase())) return pass()
    if (i.profile.willingToRelocate) return pass()
    if (contestedWorldwide(i)) return unknown(contestedQuestion(i))
    return fail(
      `The role is ${policy} in ${countries.join(', ')} and you are not open to relocating.`,
      i.claims.onsite.quote,
    )
  },
}

const remoteScopeExcludesCountry: Rule = {
  id: 'remote-scope-excludes-country',
  appliesWhen: (i) => isHard(i, 'location'),
  evaluate: (i) => {
    const scope = i.claims.remoteScope
    const countries = acceptableCountries(i)

    switch (scope.kind) {
      case 'worldwide':
        return contestedWorldwide(i) ? unknown(contestedQuestion(i)) : pass()

      case 'none':
        // Not a remote role at all — onsiteRequiresRelocation owns this case.
        return pass()

      case 'countries': {
        const list = (scope.countries ?? []).map((c) => c.toUpperCase())
        if (list.length === 0) {
          return unknown('The posting restricts hiring by country but does not list them.')
        }
        return list.some((c) => countries.has(c))
          ? pass()
          : fail(
              `Hiring is limited to ${list.join(', ')}, outside where you can work (${[...countries].join(', ')}).`,
              scope.quote,
            )
      }

      case 'regions': {
        const regions = scope.regions ?? []
        if (regions.length === 0) {
          return unknown('The posting restricts hiring by region but does not name one.')
        }
        const named = regions.filter((r) => r !== 'worldwide')
        if (named.some((r) => selectedRegions(i).includes(r))) return pass()
        const memberships = [...countries].map((c) => countryInAnyRegion(c, named))
        if (memberships.includes('in')) return pass()
        if (regions.includes('worldwide')) return contestedWorldwide(i) ? unknown(contestedQuestion(i)) : pass()
        if (memberships.includes('unknown')) {
          return unknown(
            `The posting hires in ${regions.join(', ')}; whether ${[...countries].join(', ')} qualifies is unclear.`,
          )
        }
        return fail(
          `Hiring is limited to ${regions.join(', ')}, outside where you can work.`,
          scope.quote,
        )
      }

      case 'unspecified':
        // The ambiguous case the product exists for.
        return workplace(i) === 'remote'
          ? unknown('The posting says remote but does not say which countries it accepts.')
          : pass()
    }
  },
}

/**
 * THE US-ONLY TRAP. "Must be authorized to work in the US" is an authorization
 * requirement, not a location restriction. A candidate may satisfy it via a visa
 * or an employer of record. This rule must never fire merely because a posting
 * mentions US authorization — only when the candidate holds none of the required
 * authorizations AND sponsorship is explicitly not offered.
 */
const authorizationMissing: Rule = {
  id: 'authorization-missing',
  appliesWhen: (i) => isHard(i, 'authorization'),
  evaluate: (i) => {
    const auth = i.claims.authorization
    const held = authorizedCountries(i)

    // D4: working onsite abroad needs authorization there, whether or not the posting
    // says so. Silence about a remote role is still not evidence of a requirement.
    // A contested worldwide claim leaves the arrangement unclear: it implies nothing (engine v5).
    const onsiteAbroad = !contestedWorldwide(i) && (workplace(i) === 'onsite' || workplace(i) === 'hybrid')
      ? workplaceCountries(i)
      : []
    const implied = onsiteAbroad.length > 0 && !onsiteAbroad.some((c) => held.has(c)) ? onsiteAbroad : []

    if (auth.required === true) {
      const stated = (auth.countries ?? []).map((c) => c.toUpperCase())
      if (stated.length === 0 && implied.length === 0) {
        return unknown('Work authorization is required but the posting does not say where.')
      }
      if (stated.length > 0 && stated.some((c) => held.has(c)) && implied.length === 0) return pass()
    } else if (implied.length === 0) {
      return pass()
    }

    const required = [...new Set([...(auth.required === true ? (auth.countries ?? []).map((c) => c.toUpperCase()) : []), ...implied])]
      .filter((c) => !held.has(c))
    if (required.length === 0) return pass()
    if (auth.sponsorshipOffered === true) return pass()
    if (auth.sponsorshipOffered === undefined || auth.sponsorshipOffered === 'unspecified') {
      return unknown(
        `You would need work authorization in ${required.join(', ')}, and the posting does not say whether it sponsors visas.`,
      )
    }

    return fail(
      `Requires work authorization in ${required.join(', ')}, which you do not hold, and sponsorship is not offered.`,
      auth.quote,
    )
  },
}

const timezoneOverlapImpossible: Rule = {
  id: 'timezone-overlap-impossible',
  appliesWhen: (i) => isHard(i, 'timezone'),
  evaluate: (i) => {
    const tz = i.claims.timezone
    if (tz.kind === 'unspecified' || tz.kind === 'none') return pass()
    if (tz.reference === undefined) {
      return unknown('The posting requires timezone overlap but does not say with where.')
    }

    const required = tz.overlapHours ?? 4
    const achievable = achievableOverlapHours(
      i.profile.timezone,
      tz.reference,
      i.profile.workingHours ?? { start: 9, end: 18 },
    )
    if (achievable === null) {
      return unknown(`Could not compare your timezone with ${tz.reference}.`)
    }
    if (achievable >= required - OVERLAP_TOLERANCE_HOURS) return pass()

    return fail(
      `Requires ${required}h overlap with ${tz.reference}; your working hours allow about ${achievable.toFixed(1)}h.`,
      tz.quote,
    )
  },
}

const employmentTypeMismatch: Rule = {
  id: 'employment-type-mismatch',
  appliesWhen: (i) => isHard(i, 'employmentType'),
  evaluate: (i) => {
    const kind = i.claims.employmentType.kind
    if (kind === 'unspecified' || kind === 'either') return pass()
    if (i.profile.employmentTypes.includes(kind)) return pass()
    return fail(
      `The role is ${kind}-only and you have not accepted ${kind} arrangements.`,
      i.claims.employmentType.quote,
    )
  },
}

/**
 * An unstated salary never blocks eligibility — matching reports it as unknown.
 * Only a posted maximum below the floor, in the same currency, is a rejection.
 */
const salaryBelowFloor: Rule = {
  id: 'salary-below-floor',
  appliesWhen: (i) => isHard(i, 'salary') && i.profile.salaryFloorMinor !== null,
  evaluate: (i) => {
    const floor = i.profile.salaryFloorMinor
    if (floor === null) return pass()
    if (i.job.salarySource !== 'posted') return pass()
    if (i.job.salaryCurrency === null || i.job.salaryCurrency !== i.profile.salaryCurrency) {
      return pass()
    }
    const max = i.job.salaryMaxMinor ?? i.job.salaryMinMinor
    if (max === null) return pass()
    if (max >= floor) return pass()
    return fail(
      `The posted maximum is below your floor of ${floor / 100} ${i.profile.salaryCurrency}.`,
    )
  },
}

const relocationRequired: Rule = {
  id: 'relocation-required',
  appliesWhen: (i) => isHard(i, 'relocation'),
  evaluate: (i) => {
    const reloc = i.claims.relocation
    if (reloc.required !== true) return pass()
    if (i.profile.willingToRelocate) return pass()
    return fail('The role requires relocation and you are not open to it.', reloc.quote)
  },
}

/** Ordered. The first `fail` wins. */
export const RULES: readonly Rule[] = [
  onsiteRequiresRelocation,
  relocationRequired,
  remoteScopeExcludesCountry,
  authorizationMissing,
  employmentTypeMismatch,
  timezoneOverlapImpossible,
  salaryBelowFloor,
]
