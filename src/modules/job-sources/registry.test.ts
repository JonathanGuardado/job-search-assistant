import { describe, expect, it } from 'vitest'
import { ADAPTER_KEYS } from './adapter.js'
import { greenhouseAdapter } from './adapters/greenhouse.js'
import { leverAdapter } from './adapters/lever.js'
import { getAdapter } from './registry.js'

describe('source adapter registry', () => {
  it('returns each declared adapter without dynamic loading', () => {
    expect(getAdapter('greenhouse')).toBe(greenhouseAdapter)
    expect(getAdapter('lever')).toBe(leverAdapter)
    expect(ADAPTER_KEYS.map((key) => getAdapter(key).key)).toEqual([...ADAPTER_KEYS])
  })
})
