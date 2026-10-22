import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NewSourceSchema, SourcePollPayloadSchema } from './types.js'

describe('source input boundaries', () => {
  it('trims source name and token and restricts the token to a path segment', () => {
    expect(NewSourceSchema.parse({ adapterKey: 'greenhouse', name: ' Fixture Co ', token: ' fixture-board ' })).toEqual({ adapterKey: 'greenhouse', name: 'Fixture Co', token: 'fixture-board' })
    for (const token of ['../other', 'https://other.example', 'foo?bar', '', 'a'.repeat(101)]) {
      expect(NewSourceSchema.safeParse({ adapterKey: 'greenhouse', name: 'Fixture Co', token }).success).toBe(false)
    }
  })
  it('accepts bounded queue payloads and rejects reserved characters and invalid IDs', () => {
    // Dates cross Redis as ISO strings.
    const payload = { sourceId: randomUUID(), pollId: 'w1792497600000', cursor: null, startedAt: '2026-10-21T00:00:00.000Z' }
    expect(SourcePollPayloadSchema.parse(payload).startedAt).toEqual(new Date('2026-10-21T00:00:00.000Z'))
    const { startedAt: _startedAt, ...withoutStart } = payload
    for (const invalid of [withoutStart, { ...payload, startedAt: 'not a date' }, { ...payload, sourceId: 'wrong' }, { ...payload, pollId: 'reserved:key' }, { ...payload, cursor: '100:200' }, { ...payload, cursor: 'a'.repeat(201) }]) {
      expect(SourcePollPayloadSchema.safeParse(invalid).success).toBe(false)
    }
  })
})
