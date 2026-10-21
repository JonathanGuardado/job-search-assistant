import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { getJson } from './http.js'

const schema = z.object({ name: z.string() })
describe('source JSON GET', () => {
  it('sends the declared headers and timeout, refuses redirects, and validates JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'Board' }))
    expect(await getJson('https://example.com', schema, fetcher)).toEqual({ ok: true, value: { name: 'Board' } })
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { Accept: 'application/json', 'User-Agent': 'JobSeekerAssistant/0.1' }, redirect: 'error', signal: expect.any(AbortSignal) })
  })
  it.each([404, 500])('redacts error bodies and does not retry HTTP %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive-body', { status }))
    const result = await getJson('https://example.com', schema, fetcher)
    expect(result).toMatchObject({ ok: false, error: { message: `HTTP ${status}` } })
    expect(JSON.stringify(result)).not.toContain('sensitive-body')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('maps JSON parse and envelope validation errors to validation_failed', async () => {
    for (const response of [new Response('not JSON'), Response.json({ name: 123 })]) {
      expect(await getJson('https://example.com', schema, async () => response)).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
    }
  })
  it('redacts thrown fetch errors and never retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private-token'))
    const result = await getJson('https://example.com', schema, fetcher)
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream_failed' } })
    expect(JSON.stringify(result)).not.toContain('private-token')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
