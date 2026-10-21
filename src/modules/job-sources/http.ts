import type { z } from 'zod'
import { domainError, err, ok, type Result } from '@/lib/result'
import type { Fetcher } from './adapter.js'

export async function getJson<S extends z.ZodType>(url: string, schema: S, fetcher: Fetcher): Promise<Result<z.output<S>>> {
  let response: Response
  try {
    response = await fetcher(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'JobSeekerAssistant/0.1' },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
  } catch {
    return err(domainError('upstream_failed', 'Source request failed or timed out.'))
  }
  if (!response.ok) {
    return err(domainError(response.status === 404 ? 'not_found' : 'upstream_failed', `HTTP ${response.status}`))
  }
  try {
    const payload: unknown = await response.json()
    const parsed = schema.safeParse(payload)
    return parsed.success ? ok(parsed.data) : err(domainError('validation_failed', 'Source response did not match the expected JSON schema.'))
  } catch {
    return err(domainError('validation_failed', 'Source response was not valid JSON.'))
  }
}
