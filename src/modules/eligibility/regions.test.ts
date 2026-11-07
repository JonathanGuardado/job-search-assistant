import { describe, expect, it } from 'vitest'
import { openToRegion } from './regions.js'
import type { EligibilityClaims } from './types.js'

type Scope = EligibilityClaims['remoteScope']

describe('openToRegion: where a posting\'s remote scope lets someone work from, for filtering a list', () => {
  const worldwide: Scope = { kind: 'worldwide' }
  const americas: Scope = { kind: 'regions', regions: ['latam', 'namer'] }
  const brazil: Scope = { kind: 'countries', countries: ['BR'] }
  const usOnly: Scope = { kind: 'countries', countries: ['US'] }

  it('a worldwide posting is open to every region, and is the only kind open to "worldwide"', () => {
    for (const region of ['latam', 'namer', 'emea', 'apac', 'worldwide'] as const) expect(openToRegion(worldwide, region), region).toBe(true)
    expect(openToRegion({ kind: 'regions', regions: ['worldwide'] }, 'emea')).toBe(true)
    expect(openToRegion(americas, 'worldwide')).toBe(false)
  })

  it('a posting naming regions is open to those; one naming countries, to the regions they are in', () => {
    expect(openToRegion(americas, 'latam')).toBe(true)
    expect(openToRegion(americas, 'namer')).toBe(true)
    expect(openToRegion(americas, 'emea')).toBe(false)
    expect(openToRegion(brazil, 'latam')).toBe(true)
    expect(openToRegion(usOnly, 'latam')).toBe(false)
    expect(openToRegion({ kind: 'regions', regions: [], countries: ['MX'] }, 'latam')).toBe(true)
  })

  it('a posting that is not remote, or never says where, is open to no region', () => {
    expect(openToRegion({ kind: 'none' }, 'latam')).toBe(false)
    expect(openToRegion({ kind: 'unspecified' }, 'latam')).toBe(false)
    expect(openToRegion({ kind: 'countries', countries: ['ZZ'] }, 'latam')).toBe(false)
  })
})
