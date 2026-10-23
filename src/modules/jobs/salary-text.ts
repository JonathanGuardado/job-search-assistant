import type { Salary } from './types.js'

/*
 * A salary range the employer states in the posting's text, read by plain code. Boards
 * rarely fill a structured salary (2 of 4,176 captured postings), but US pay-transparency
 * laws put a range in most descriptions. Being wrong here would put a false "below your
 * floor" on a card, so anything that is not clearly an annual salary is left unknown:
 * hourly and monthly rates, on-target earnings, money that is not pay, and postings that
 * state ranges in more than one currency.
 */

const CURRENCY_MARKS: Readonly<Record<string, string>> = {
  'US$': 'USD', 'CA$': 'CAD', 'A$': 'AUD', 'R$': 'BRL', $: 'USD', '€': 'EUR', '£': 'GBP',
  USD: 'USD', CAD: 'CAD', EUR: 'EUR', GBP: 'GBP', AUD: 'AUD', BRL: 'BRL', MXN: 'MXN',
}
const MARK = String.raw`US\$|CA\$|A\$|R\$|[$€£]|USD|CAD|EUR|GBP|AUD|BRL|MXN`
const AMOUNT = String.raw`(?:(${MARK})\s?)?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2}(?!\d))?\s?([kK])?`
const RANGE = new RegExp(String.raw`${AMOUNT}\s?(?:-|–|—|to)\s?${AMOUNT}(?:\s?(USD|CAD|EUR|GBP|AUD|BRL|MXN)\b)?`, 'g')

/** The range must sit on, or under, a line that talks about pay. */
const PAY_WORDS = /\b(salary|salaries|compensation|pay|base|wages?|remuneration)\b/i
/** On-target earnings include commission; hourly and monthly rates are not annual. */
const NOT_ANNUAL = /\bOTE\b|on[- ]target|per hour|hourly|\/\s?(?:hr|hour)\b|per month|monthly|\/\s?mo(?:nth)?\b/i

/** Plausible annual salaries in major units: below this it is a rate, above it a deal size. */
const ANNUAL_MIN = 10_000
const ANNUAL_MAX = 10_000_000

const minorDigits = (currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2

function majorUnits(digits: string, thousands: string | undefined): number {
  const whole = Number(digits.replace(/[.,]/g, ''))
  return thousands ? whole * 1000 : whole
}

type Range = { readonly min: number; readonly max: number; readonly currency: string; readonly line: string }

function rangesIn(line: string): Range[] {
  const found: Range[] = []
  for (const m of line.matchAll(RANGE)) {
    const [, markA, digitsA = '', kA, markB, digitsB = '', kB, trailing] = m
    const mark = trailing ?? markB ?? markA
    if (mark === undefined) continue
    const currency = CURRENCY_MARKS[mark]
    if (currency === undefined) continue
    // "$150k–$200k" and "$150–200k" both mean thousands.
    const min = majorUnits(digitsA, kA ?? (digitsA.length <= 3 ? kB : undefined))
    const max = majorUnits(digitsB, kB)
    if (min < ANNUAL_MIN || max > ANNUAL_MAX || min > max) continue
    found.push({ min, max, currency, line: line.trim() })
  }
  return found
}

export function salaryFromText(text: string): { readonly salary: Extract<Salary, { source: 'posted' }>; readonly quote: string } | null {
  const lines = text.split('\n')
  const ranges: Range[] = []
  for (const [index, line] of lines.entries()) {
    if (NOT_ANNUAL.test(line)) continue
    const here = rangesIn(line)
    if (here.length === 0) continue
    // The heading a list of ranges hangs under: the nearest earlier line that is not itself a range.
    let context = line
    for (let i = index - 1; i >= 0 && !PAY_WORDS.test(context); i--) {
      const earlier = lines[i] ?? ''
      if (earlier.trim() === '' || rangesIn(earlier).length > 0) continue
      context = `${line}\n${earlier}`
      break
    }
    if (!PAY_WORDS.test(context) || NOT_ANNUAL.test(context)) continue
    ranges.push(...here)
  }
  const first = ranges[0]
  if (!first) return null
  // One currency only: a posting with US and Canadian ranges does not say which applies.
  if (ranges.some((r) => r.currency !== first.currency)) return null
  const scale = 10 ** minorDigits(first.currency)
  return {
    salary: {
      source: 'posted',
      minMinor: Math.min(...ranges.map((r) => r.min)) * scale,
      maxMinor: Math.max(...ranges.map((r) => r.max)) * scale,
      currency: first.currency,
    },
    quote: first.line,
  }
}
