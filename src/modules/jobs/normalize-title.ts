import { foldText } from './text.js'
import { SENIORITIES, type Seniority } from './types.js'

const SENIORITY_WORDS: ReadonlyMap<string, Seniority> = new Map([
  ['intern', 'intern'], ['internship', 'intern'], ['junior', 'junior'], ['jr', 'junior'],
  ['senior', 'senior'], ['sr', 'senior'], ['lead', 'lead'], ['staff', 'staff'], ['principal', 'principal'],
])

// A qualifier is a board decoration only if every word is one of these and at least one
// is strong. "(Remote - LATAM)" is a decoration; "Contract Management" and "Global Sales" are not.
const STRONG_DECORATION = new Set([
  'remote', 'hybrid', 'onsite', 'latam', 'emea', 'apac', 'apj', 'amer', 'americas', 'anywhere', 'worldwide',
  'contract', 'contractor', 'freelance', 'temporary', 'full', 'part',
])
const WEAK_DECORATION = new Set([
  'on', 'site', 'in', 'office', 'home', 'based', 'first', 'time', 'term', 'fixed', 'only', 'or', 'and', 'us', 'usa', 'uk', 'eu',
])

const isDecoration = (words: readonly string[]) =>
  words.some((w) => STRONG_DECORATION.has(w)) && words.every((w) => STRONG_DECORATION.has(w) || WEAK_DECORATION.has(w))

const wordsIn = (segment: string) => segment.match(/[\p{L}\p{N}]+/gu) ?? []

export type ParsedTitle = { readonly titleNormalized: string; readonly seniority: Seniority | null }

/**
 * The title's comparison key and the seniority it states. Decorations boards add
 * ("(Remote - LATAM)", "| Remote |") are dropped; level numerals ("II") are kept, since
 * they name different jobs. Seniority is read from leading words only, so "Chief of
 * Staff" has none. The verbatim title is kept
 * on the job, and eligibility reads that, not this.
 */
export function normalizeTitle(title: string): ParsedTitle {
  const folded = foldText(title)
  const parentheticals = [...folded.matchAll(/[([]([^()[\]]*)[)\]]/g)].map((m) => m[1] ?? '')
  const segments = [
    ...folded.replace(/[([][^()[\]]*[)\]]/g, ' ').split(/\s[-–—]\s|[|,]/),
    ...parentheticals,
  ]
  const kept = segments.map(wordsIn).filter((words) => words.length > 0 && !isDecoration(words)).flat()

  const levels: Seniority[] = []
  while (kept.length > 0 && SENIORITY_WORDS.has(kept[0] ?? '')) {
    const level = SENIORITY_WORDS.get(kept.shift() ?? '')
    if (level) levels.push(level)
  }
  // "Senior Staff Engineer" is staff: the most senior word wins.
  const seniority = levels.reduce<Seniority | null>(
    (best, level) => (best === null || SENIORITIES.indexOf(level) > SENIORITIES.indexOf(best) ? level : best), null,
  )
  return { titleNormalized: kept.length > 0 ? kept.join(' ') : wordsIn(folded).join(' '), seniority }
}
