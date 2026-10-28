import type { z } from 'zod'
import { domainError, err, ok, type Result } from '@/lib/result'

type JsonRequest<S extends z.ZodType> = {
  readonly provider: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
  readonly schema: S
}

/** API errors can echo prompts or credentials, so only status codes leave this boundary. */
export async function postJson<S extends z.ZodType>(
  request: JsonRequest<S>,
  fetcher: typeof fetch,
): Promise<Result<z.output<S>>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
    let response: Response
    try {
      response = await fetcher(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...request.headers },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(60_000),
        redirect: 'error',
      })
    } catch {
      if (attempt < 2) continue
      return err(domainError('upstream_failed', `${request.provider}: network failure or timeout`))
    }
    if (!response.ok) {
      await response.body?.cancel()
      const retryable = [408, 409, 429].includes(response.status) || response.status >= 500
      if (retryable && attempt < 2) continue
      // Out of credit: still upstream_failed, so callers write nothing and the call can succeed once credit is added.
      if (response.status === 402) return err(domainError('upstream_failed', `${request.provider}: out of credit (HTTP 402); add credit with the provider`))
      return err(domainError(response.status === 429 ? 'rate_limited' : 'upstream_failed', `${request.provider}: HTTP ${response.status}`))
    }
    try {
      const payload: unknown = await response.json()
      const parsed = request.schema.safeParse(payload)
      return parsed.success
        ? ok(parsed.data)
        : err(domainError('upstream_failed', `${request.provider}: invalid response envelope`))
    } catch {
      return err(domainError('upstream_failed', `${request.provider}: invalid JSON response`))
    }
  }
  return err(domainError('upstream_failed', `${request.provider}: retry limit reached`))
}
