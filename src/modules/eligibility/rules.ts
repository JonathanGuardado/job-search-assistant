import { countryInAnyRegion } from './regions.js'
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

/** The arrangement the text states, falling back to the structured field. */
function workplace(input: RuleInput): 'onsite' | 'hybrid' | 'remote' | 'unknown' {
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
        return pass()

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
        if (regions.some((r) => r === 'worldwide' || selectedRegions(i).includes(r))) return pass()
        const memberships = [...countries].map((c) => countryInAnyRegion(c, regions))
        if (memberships.includes('in')) return pass()
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
    const onsiteAbroad = workplace(i) === 'onsite' || workplace(i) === 'hybrid'
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
