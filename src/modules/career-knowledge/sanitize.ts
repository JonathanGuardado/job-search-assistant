import type {
  CareerItemDraft,
  Evidence,
  ExtractedItem,
  ExtractedResume,
  PartialDate,
  RejectedValue,
} from './types.js'
import { createLocator, type Locate, type Span } from './verbatim.js'

/**
 * Deterministic gate between the model and the database. The model proposes;
 * this keeps only what the resume actually says. A value that fails is dropped
 * (and reported), never repaired with a guess.
 */

const PRESENT_MARKERS =
  /\b(present|current|currently|now|today|ongoing|presente|actualidad|actual|actualmente|hoy)\b/

// English and Spanish month names and abbreviations → month number.
const MONTH_WORDS: ReadonlyMap<string, number> = new Map(
  (
    [
      ['january jan enero ene', 1],
      ['february feb febrero', 2],
      ['march mar marzo', 3],
      ['april apr abril abr', 4],
      ['may mayo', 5],
      ['june jun junio', 6],
      ['july jul julio', 7],
      ['august aug agosto ago', 8],
      ['september sep sept septiembre setiembre set', 9],
      ['october oct octubre', 10],
      ['november nov noviembre', 11],
      ['december dec diciembre dic', 12],
    ] as const
  ).flatMap(([words, month]) => words.split(' ').map((word) => [word, month] as const)),
)

/** Months a date quote explicitly states, by name or in numeric form (03/2020, 2020-03). */
function monthsIn(quote: string): Set<number> {
  const found = new Set<number>()
  const lower = quote.toLowerCase()
  for (const word of lower.match(/\p{L}+/gu) ?? []) {
    const month = MONTH_WORDS.get(word)
    if (month !== undefined) found.add(month)
  }
  for (const m of lower.matchAll(/\b(0?[1-9]|1[0-2])[/.-]\d{4}\b|\b\d{4}[/.-](0?[1-9]|1[0-2])\b/g)) {
    const month = Number(m[1] ?? m[2])
    if (Number.isInteger(month)) found.add(month)
  }
  return found
}

/** Collapses the source's line wrapping so stored values read as single lines. */
const tidy = (span: Span): string => span.text.replace(/\s+/g, ' ').trim()

function sanitizeItem(
  extracted: ExtractedItem,
  itemIndex: number,
  locate: Locate,
  rejected: RejectedValue[],
): CareerItemDraft | null {
  const reject = (field: string, value: string, reason: RejectedValue['reason']) =>
    rejected.push({ itemIndex, field, value, reason })

  const evidence: Evidence = { achievements: [], technologies: [] }

  const text = (field: 'organization' | 'title' | 'summary', value: string | null): string | null => {
    if (value === null) return null
    const span = locate(value, { wholeWord: true })
    if (!span) {
      reject(field, value, 'not_in_source')
      return null
    }
    evidence[field] = span
    return tidy(span)
  }

  const date = (
    field: 'startedOn' | 'endedOn',
    claim: ExtractedItem['startedOn'],
  ): PartialDate | null => {
    if (claim === null) return null
    const span = locate(claim.quote, { wholeWord: true })
    if (!span) {
      reject(field, claim.quote, 'not_in_source')
      return null
    }
    const [year, month] = claim.value.split('-')
    if (year === undefined || !new RegExp(`\\b${year}\\b`).test(span.text)) {
      reject(field, claim.value, 'date_not_in_quote')
      return null
    }
    evidence[field] = span
    if (month !== undefined && !monthsIn(span.text).has(Number(month))) {
      reject(field, claim.value, 'month_not_in_quote')
      return year
    }
    return claim.value
  }

  const organization = text('organization', extracted.organization)
  const title = text('title', extracted.title)
  const startedOn = date('startedOn', extracted.startedOn)
  let endedOn = date('endedOn', extracted.endedOn)

  let isCurrent = false
  if (extracted.current !== null) {
    const span = locate(extracted.current.quote, { wholeWord: true })
    if (!span) {
      reject('current', extracted.current.quote, 'not_in_source')
    } else if (!PRESENT_MARKERS.test(span.text.toLowerCase())) {
      reject('current', extracted.current.quote, 'not_marked_current')
    } else {
      isCurrent = true
      evidence.isCurrent = span
      if (endedOn !== null) {
        reject('endedOn', endedOn, 'conflicts_with_current')
        endedOn = null
        delete evidence.endedOn
      }
    }
  }

  const summary = text('summary', extracted.summary)

  const achievements: string[] = []
  for (const achievement of extracted.achievements) {
    const span = locate(achievement, { wholeWord: true })
    if (!span) {
      reject('achievements', achievement, 'not_in_source')
      continue
    }
    achievements.push(tidy(span))
    evidence.achievements.push(span)
  }

  const technologies: string[] = []
  for (const technology of extracted.technologies) {
    const span = locate(technology, { wholeWord: true })
    if (!span) {
      reject('technologies', technology, 'not_in_source')
      continue
    }
    const name = tidy(span)
    if (technologies.some((t) => t.toLowerCase() === name.toLowerCase())) continue
    technologies.push(name)
    evidence.technologies.push(span)
  }

  // Dates and technologies alone do not say what the entry was.
  if (organization === null && title === null && summary === null && achievements.length === 0) {
    reject('item', extracted.title ?? extracted.organization ?? `item ${itemIndex}`, 'empty_item')
    return null
  }

  return {
    type: extracted.type,
    organization,
    title,
    startedOn,
    endedOn,
    isCurrent,
    summary,
    achievements,
    technologies,
    evidence,
  }
}

export function sanitizeExtractedResume(
  extracted: ExtractedResume,
  sourceText: string,
): { readonly drafts: CareerItemDraft[]; readonly rejected: RejectedValue[] } {
  const locate = createLocator(sourceText)
  const rejected: RejectedValue[] = []
  const drafts = extracted.items.flatMap((item, index) => {
    const draft = sanitizeItem(item, index, locate, rejected)
    return draft ? [draft] : []
  })
  return { drafts, rejected }
}
