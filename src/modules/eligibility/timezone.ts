/**
 * Timezone overlap arithmetic for the `timezone-overlap-impossible` rule.
 * Deliberately forgiving: loose phrasing like "significant overlap with PST"
 * should not reject a candidate over a fraction of an hour.
 */

const DEFAULT_WINDOW = { start: 9, end: 18 } as const

export function utcOffsetHours(timeZone: string, at: Date = new Date()): number | null {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).format(at)
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(formatted)
    if (!match) return formatted.includes('GMT') ? 0 : null
    const [, sign, hours, minutes] = match
    if (hours === undefined || minutes === undefined) return null
    const magnitude = Number(hours) + Number(minutes) / 60
    return sign === '-' ? -magnitude : magnitude
  } catch {
    return null
  }
}

type Window = { start: number; end: number }

function toUtcWindow(window: Window, offset: number): Window {
  return { start: window.start - offset, end: window.end - offset }
}

function overlapLength(a: Window, b: Window): number {
  // Try the day before, the same day, and the day after to handle wraparound.
  let best = 0
  for (const shift of [-24, 0, 24]) {
    const shifted = { start: b.start + shift, end: b.end + shift }
    const length = Math.min(a.end, shifted.end) - Math.max(a.start, shifted.start)
    if (length > best) best = length
  }
  return best
}

/**
 * Hours of overlap achievable between the candidate's working window and the
 * reference zone's working window. Returns null when a zone is unrecognizable.
 */
export function achievableOverlapHours(
  candidateTimeZone: string,
  referenceTimeZone: string,
  candidateWindow: Window = DEFAULT_WINDOW,
  referenceWindow: Window = DEFAULT_WINDOW,
): number | null {
  const candidateOffset = utcOffsetHours(candidateTimeZone)
  const referenceOffset = utcOffsetHours(referenceTimeZone)
  if (candidateOffset === null || referenceOffset === null) return null

  return overlapLength(
    toUtcWindow(candidateWindow, candidateOffset),
    toUtcWindow(referenceWindow, referenceOffset),
  )
}

/** Tolerance absorbing loose phrasing. See docs/eligibility-spec.md. */
export const OVERLAP_TOLERANCE_HOURS = 1
