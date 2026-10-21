import { createHash } from 'node:crypto'
import { z } from 'zod'

const JsonSchema = z.json()
type Json = z.infer<typeof JsonSchema>

function serialize(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, nested]) => `${JSON.stringify(key)}:${serialize(nested)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function canonicalJson(value: unknown): string {
  return serialize(JsonSchema.parse(value))
}

export function contentHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}
