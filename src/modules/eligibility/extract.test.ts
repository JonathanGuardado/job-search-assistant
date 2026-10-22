import { describe, expect, it } from 'vitest'
import { claimsFromOutput, ExtractionOutputSchema } from './extract.js'

describe('the extraction output schema', () => {
  const output = {
    remoteScope: { kind: 'regions', regions: ['latam', 'namer'], quote: 'Remote in the Americas' },
    authorization: { required: 'unspecified', quote: null },
    timezone: { kind: 'unspecified', quote: null },
    employmentType: { kind: 'unspecified', quote: null },
    relocation: { required: 'unspecified', quote: null },
    onsite: { kind: 'remote', quote: 'Remote' },
  }

  it('requires a quote key on every claim, so the model cannot silently omit one', () => {
    const { quote: _quote, ...unquotedScope } = output.remoteScope
    expect(ExtractionOutputSchema.safeParse({ ...output, remoteScope: unquotedScope }).success).toBe(false)
  })

  it('maps null quotes to absent ones and keeps stated quotes', () => {
    const claims = claimsFromOutput(ExtractionOutputSchema.parse(output))
    expect(claims.remoteScope).toEqual({ kind: 'regions', regions: ['latam', 'namer'], quote: 'Remote in the Americas' })
    expect(claims.authorization).toEqual({ required: 'unspecified' })
  })
})
