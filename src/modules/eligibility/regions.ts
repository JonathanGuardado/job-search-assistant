import type { Region } from './types.js'

/**
 * Minimal country → region mapping. Extend as sources surface new phrasings.
 * Kept deliberately small: a country missing here yields 'unknown', which the
 * rules treat as an open question rather than a rejection.
 */
export const REGION_COUNTRIES: Readonly<Record<Exclude<Region, 'worldwide'>, readonly string[]>> = {
  latam: [
    'AR', 'BO', 'BR', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'SV', 'GT', 'HN',
    'MX', 'NI', 'PA', 'PY', 'PE', 'PR', 'UY', 'VE',
  ],
  namer: ['US', 'CA'],
  emea: [
    'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
    'GB', 'GR', 'HR', 'HU', 'IE', 'IL', 'IS', 'IT', 'LT', 'LU', 'LV', 'MT',
    'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'TR', 'UA', 'ZA',
    'AE', 'EG', 'KE', 'NG', 'MA',
  ],
  apac: [
    'AU', 'BD', 'CN', 'HK', 'ID', 'IN', 'JP', 'KR', 'MY', 'NZ', 'PH', 'PK',
    'SG', 'TH', 'TW', 'VN',
  ],
}

export type RegionMembership = 'in' | 'out' | 'unknown'

export function countryInRegion(country: string, region: Region): RegionMembership {
  if (region === 'worldwide') return 'in'
  const list = REGION_COUNTRIES[region]
  const code = country.toUpperCase()
  if (list.includes(code)) return 'in'
  // The country is known to us but not in this region.
  const known = Object.values(REGION_COUNTRIES).some((l) => l.includes(code))
  return known ? 'out' : 'unknown'
}

export function countryInAnyRegion(
  country: string,
  regions: readonly Region[],
): RegionMembership {
  let sawUnknown = false
  for (const region of regions) {
    const result = countryInRegion(country, region)
    if (result === 'in') return 'in'
    if (result === 'unknown') sawUnknown = true
  }
  return sawUnknown ? 'unknown' : 'out'
}
