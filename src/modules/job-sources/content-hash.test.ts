import { describe, expect, it } from 'vitest'
import { canonicalJson, contentHash } from './content-hash.js'

describe('raw posting content hashes', () => {
  it('ignores object key order, including nested objects', () => {
    expect(contentHash({ b: 2, a: { z: 0, a: 1 } })).toBe(contentHash({ a: { a: 1, z: 0 }, b: 2 }))
    expect(canonicalJson({ b: 2, a: { z: 0, a: 1 } })).toBe('{"a":{"a":1,"z":0},"b":2}')
  })
  it('preserves array order', () => expect(contentHash([1, 2])).not.toBe(contentHash([2, 1])))
  it('detects a value change', () => expect(contentHash({ title: 'One' })).not.toBe(contentHash({ title: 'Two' })))
  it('produces 64 lowercase hex characters', () => expect(contentHash({ a: null })).toMatch(/^[a-f0-9]{64}$/))
  it('sorts numeric-looking keys and Unicode keys by UTF-16 code unit', () => {
    expect(canonicalJson({ '2': 'two', '10': 'ten', '\ue000': 1, '😀': 2 })).toBe('{"10":"ten","2":"two","😀":2,"":1}')
  })
  it('leaves named top-level volatile keys out of the hash, but not nested keys with the same name', () => {
    const posting = { id: 1, title: 'Engineer', updated_at: '2026-10-20T17:25:53-04:00', meta: { updated_at: 'a' } }
    expect(contentHash({ ...posting, updated_at: '2026-10-21T14:53:01-04:00' }, ['updated_at'])).toBe(contentHash(posting, ['updated_at']))
    expect(contentHash({ ...posting, meta: { updated_at: 'b' } }, ['updated_at'])).not.toBe(contentHash(posting, ['updated_at']))
    expect(contentHash({ ...posting, title: 'Manager' }, ['updated_at'])).not.toBe(contentHash(posting, ['updated_at']))
  })
  it('retains null, booleans, strings and objects within arrays', () => {
    expect(canonicalJson([null, true, 'line\n', { z: false, a: [] }])).toBe('[null,true,"line\\n",{"a":[],"z":false}]')
  })
})
