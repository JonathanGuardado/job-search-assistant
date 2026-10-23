import { describe, expect, it } from 'vitest'
import { salaryFromText } from './salary-text.js'

// Every line below is from a captured posting (2026-10-22).

describe('salaryFromText: ranges employers state in the posting', () => {
  it.each([
    ['The reasonably estimated yearly salary for this role at Datadog is:\n$143,000—$190,000 USD', 14_300_000, 19_000_000, 'USD'],
    ['United States Salary Range\n$124,000—$186,600 USD', 12_400_000, 18_660_000, 'USD'],
    ['Salary: $173,400 - $260,200', 17_340_000, 26_020_000, 'USD'],
    ['Salary: $173,000 - $259,600/yr.', 17_300_000, 25_960_000, 'USD'],
    ['The expected salary range for this role is $184,000 - $230,000.  However, the starting base pay will depend', 18_400_000, 23_000_000, 'USD'],
    ['The expected salary range for this role is $104,000-$130,000 CAD however, the starting base pay', 10_400_000, 13_000_000, 'CAD'],
    ['In the United States, the Base compensation range for this role is USD 174,986 - USD 220,000. Actual compensation may vary', 17_498_600, 22_000_000, 'USD'],
    ['The United States base range for this position is $92,126–$131,609, plus equity.', 9_212_600, 13_160_900, 'USD'],
    ['The typical starting salary range for this role is:\n€67.000—€106.000 EUR', 6_700_000, 10_600_000, 'EUR'],
    ['Base salary: $150k–$200k', 15_000_000, 20_000_000, 'USD'],
    ['The estimated pay range is $171,120.00 to $213,900.00', 17_112_000, 21_390_000, 'USD'],
    ['In Miami the base salary range for this role is $49,129 - $57,387 plus sales incentives.', 4_912_900, 5_738_700, 'USD'],
  ] as const)('%s', (text, minMinor, maxMinor, currency) => {
    expect(salaryFromText(text)?.salary).toEqual({ source: 'posted', minMinor, maxMinor, currency })
  })

  it('quotes the line the range was read from', () => {
    const text = 'Benefits below.\nThe reasonably estimated yearly salary for this role at Datadog is:\n$143,000—$190,000 USD\nAbout Datadog'
    expect(salaryFromText(text)?.quote).toBe('$143,000—$190,000 USD')
  })

  it('spans every range in one currency: per state, per zone, typical and select locations', () => {
    const text = [
      'The estimated pay ranges for this role are as follows:',
      ' * Based in Colorado, Hawaii or Illinois : $171,120.00 to $213,900.00',
      ' * Based in New York, New Jersey, Washington State: $181,200.00 to $226,500.00',
      ' * Based in the San Francisco Bay area, California: $201,280.00 to $251,600.00.',
    ].join('\n')
    expect(salaryFromText(text)?.salary).toEqual({ source: 'posted', minMinor: 17_112_000, maxMinor: 25_160_000, currency: 'USD' })
  })
})

describe('salaryFromText: money that is not an annual salary', () => {
  it.each([
    ['hourly pay', '* Based in Colorado, Hawaii, Illinois : $26.27 - $32.84\nThe estimated pay ranges above are hourly'],
    ['a rate marked per hour', 'Compensation: $45 - $60 per hour'],
    ['a monthly salary', 'Salary range: R$ 12.000 - R$ 15.000 per month'],
    ['deal sizes', 'Proven track record managing a $5M+ annualized gross portfolio and closing $250K-$1M+ complex, multi-phase deals'],
    ['on-target earnings', 'In the UK, the OTE compensation range for this role is GBP £288,500 - £319,250. Actual compensation may vary'],
    ['a donation match', 'Increase your impact - We match up to $2000 (or local currency equivalent) for financial donations'],
    ['two currencies', 'Salary ranges:\n * US: $123,000 - $144,000 USD\n * Canada: $108,000 - $125,000 CAD'],
    ['no range at all', 'We offer a competitive salary and equity package.'],
  ])('ignores %s', (_label, text) => {
    expect(salaryFromText(text)).toBeNull()
  })
})
