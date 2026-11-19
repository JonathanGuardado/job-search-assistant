import { describe, expect, it } from 'vitest'
import { countryCodeOf } from './country-names.js'

describe('countryCodeOf', () => {
  it.each([
    ['El Salvador', 'SV'],
    ['United States', 'US'],
    ['United Kingdom', 'GB'],
    ['Mexico', 'MX'],
    ['South Korea', 'KR'],
    // Intl also names retired codes (UK, SU, DD); only the current one may come back.
    ['Germany', 'DE'],
    ['Russia', 'RU'],
    ['Serbia', 'RS'],
    ['Czechia', 'CZ'],
    // ISO short names, as job boards print them.
    ['Turkey', 'TR'],
    ['Türkiye', 'TR'],
    ['Hong Kong', 'HK'],
    ['Russian Federation', 'RU'],
    ['Congo', 'CG'],
    ['Congo, The Democratic Republic of the', 'CD'],
    ['Virgin Islands, U.S.', 'VI'],
    ['Saint Lucia', 'LC'],
    ["Côte d'Ivoire", 'CI'],
    ['Bosnia and Herzegovina', 'BA'],
    ['Bosnia & Herzegovina', 'BA'],
    ['  el salvador ', 'SV'],
  ])('%s → %s', (name, code) => {
    expect(countryCodeOf(name)).toBe(code)
  })

  it.each(['', 'Latin America', 'Europe', 'European Union', 'Worldwide', 'Remote', 'SV', 'Georgia, USA'])('does not guess at %j', (name) => {
    expect(countryCodeOf(name)).toBeNull()
  })
})
