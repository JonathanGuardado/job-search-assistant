import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect } from 'vitest'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { err, ok, unwrap } from '@/lib/result'
import type { AiError, ModelTrace } from '@/modules/ai'
import { ensureUser } from '@/modules/profiles'
import { uploadResume } from '@/modules/resumes'
import { getParseReport, runResumeParse, type ExtractCareerItems } from './parse-resume.js'
import { listCareerItems } from './service.js'
import type { ExtractedResume } from './types.js'

let storageRoot: string
let pdf: Uint8Array
beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'parse-test-'))
  pdf = await readFile(new URL('../resumes/__fixtures__/synthetic-resume.pdf', import.meta.url))
})

const trace: ModelTrace = {
  task: 'career-knowledge.extract-resume', taskVersion: 1, provider: 'fake', model: 'fake-model',
  attempt: 1, stopReason: 'stop', inputTokens: 900, outputTokens: 300, cacheReadTokens: 0,
  cacheWriteTokens: 0, costMicroUsd: 700, latencyMs: 1200, rawOutput: '{}', validationError: null,
}

const extracted: ExtractedResume = {
  items: [
    {
      type: 'role',
      organization: 'Acme Corp',
      title: 'Senior Backend Engineer',
      startedOn: { value: '2020-03', quote: 'Mar 2020' },
      endedOn: null,
      current: { quote: 'Present' },
      summary: null,
      achievements: [
        'Reduced p99 latency by 40% across the checkout service',
        'Mentored six engineers', // not in the resume
      ],
      technologies: ['Node.js', 'TypeScript'],
    },
  ],
}

/** A stub standing in for the model call, counting how often it is used. */
function stub(...responses: Awaited<ReturnType<ExtractCareerItems>>[]) {
  const calls: string[] = []
  const extract: ExtractCareerItems = async (text) => {
    calls.push(text)
    const next = responses.shift()
    if (!next) throw new Error('model called more times than expected')
    return next
  }
  return { extract, calls }
}

async function uploaded(db: Db) {
  const user = await ensureUser(db, { email: `parse-${randomUUID()}@test.local` })
  const resume = await withTenant(db, user.id, async (scope) =>
    unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot })),
  )
  return { userId: user.id, resumeId: resume.id }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const failure = (code: AiError['code']) =>
  err<AiError>({ code, message: `model ${code}`, traces: code === 'upstream_failed' ? [] : [trace] })

describe('runResumeParse', () => {
  test('stores verified drafts, the rejected values, and the cost', async ({ db }) => {
    const payload = await uploaded(db)
    const { extract, calls } = stub(ok({ value: extracted, traces: [trace] }))

    expect((await runResumeParse(db, payload, extract)).ok).toBe(true)
    expect(calls[0]).toContain('Senior Backend Engineer') // the resume's extracted text

    const items = await withTenant(db, payload.userId, (scope) => listCareerItems(scope))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      verifiedByUser: false,
      sourceResumeId: payload.resumeId,
      achievements: ['Reduced p99 latency by 40% across the checkout service'],
    })

    const report = await withTenant(db, payload.userId, (scope) => getParseReport(scope, payload.resumeId))
    expect(report.parse).toMatchObject({ status: 'succeeded', costMicroUsd: 700, model: 'fake-model' })
    expect(report.rejected).toEqual([
      { itemIndex: 0, field: 'achievements', value: 'Mentored six engineers', reason: 'not_in_source' },
    ])
  })

  test('re-running a finished parse neither calls the model nor duplicates drafts', async ({ db }) => {
    const payload = await uploaded(db)
    const { extract, calls } = stub(ok({ value: extracted, traces: [trace] }))
    await runResumeParse(db, payload, extract)
    await runResumeParse(db, payload, extract)

    expect(calls).toHaveLength(1)
    expect(await withTenant(db, payload.userId, (scope) => listCareerItems(scope))).toHaveLength(1)
  })

  test('invalid model output fails the record, keeps its traces, and is not retried', async ({ db }) => {
    const payload = await uploaded(db)
    const { extract } = stub(failure('validation_failed'))

    expect((await runResumeParse(db, payload, extract)).ok).toBe(true)
    const report = await withTenant(db, payload.userId, (scope) => getParseReport(scope, payload.resumeId))
    expect(report.parse).toMatchObject({ status: 'failed', errorCode: 'validation_failed', costMicroUsd: 700 })
    expect(await withTenant(db, payload.userId, (scope) => listCareerItems(scope))).toEqual([])
  })

  test('a provider outage asks the queue to retry, and the retry completes the same run', async ({ db }) => {
    const payload = await uploaded(db)
    const { extract } = stub(failure('upstream_failed'), ok({ value: extracted, traces: [trace] }))

    const first = await runResumeParse(db, payload, extract)
    expect(!first.ok && first.error.code).toBe('upstream_failed')
    expect((await runResumeParse(db, payload, extract)).ok).toBe(true)

    const report = await withTenant(db, payload.userId, (scope) => getParseReport(scope, payload.resumeId))
    expect(report.parse).toMatchObject({ status: 'succeeded', errorCode: null })
  })

  test('an unexpected error marks the run failed before surfacing, so it never looks in progress', async ({ db }) => {
    const payload = await uploaded(db)
    const extract: ExtractCareerItems = async () => {
      throw new Error('AI_PRIMARY_API_KEY not set for the primary model')
    }

    await expect(runResumeParse(db, payload, extract)).rejects.toThrow('AI_PRIMARY_API_KEY not set for the primary model')
    const report = await withTenant(db, payload.userId, (scope) => getParseReport(scope, payload.resumeId))
    expect(report.parse).toMatchObject({
      status: 'failed',
      errorCode: 'internal_error',
      errorMessage: 'AI_PRIMARY_API_KEY not set for the primary model',
    })
  })

  test('a second job for a run in progress does not call the model again', async ({ db }) => {
    const payload = await uploaded(db)
    const duplicate = stub()
    let duplicateResult: Awaited<ReturnType<typeof runResumeParse>> | undefined
    const extract: ExtractCareerItems = async () => {
      duplicateResult = await runResumeParse(db, payload, duplicate.extract)
      return ok({ value: extracted, traces: [trace] })
    }

    expect((await runResumeParse(db, payload, extract)).ok).toBe(true)
    expect(duplicateResult?.ok).toBe(true)
    expect(duplicate.calls).toHaveLength(0)
    expect(await withTenant(db, payload.userId, (scope) => listCareerItems(scope))).toHaveLength(1)
  })

  test('the lease is renewed during a long model call, so the run is not taken over', async ({ db }) => {
    const payload = await uploaded(db)
    const lease = { leaseMs: 200, renewEveryMs: 40 }
    const duplicate = stub()
    const extract: ExtractCareerItems = async () => {
      await sleep(500) // well past the original lease
      await runResumeParse(db, payload, duplicate.extract, lease)
      return ok({ value: extracted, traces: [trace] })
    }

    expect((await runResumeParse(db, payload, extract, lease)).ok).toBe(true)
    expect(duplicate.calls).toHaveLength(0)
  })

  test('an attempt whose lease lapsed and was reclaimed cannot overwrite the newer result', async ({ db }) => {
    const payload = await uploaded(db)
    const lease = { leaseMs: 50, renewEveryMs: 60_000 } // effectively never renewed: a stalled worker
    const newer = stub(ok({ value: extracted, traces: [trace] }))
    const extract: ExtractCareerItems = async () => {
      await sleep(120)
      expect((await runResumeParse(db, payload, newer.extract, lease)).ok).toBe(true)
      return ok({ value: { items: [] }, traces: [trace] })
    }

    expect((await runResumeParse(db, payload, extract, lease)).ok).toBe(true)
    expect(newer.calls).toHaveLength(1)
    expect(await withTenant(db, payload.userId, (scope) => listCareerItems(scope))).toHaveLength(1)
    const report = await withTenant(db, payload.userId, (scope) => getParseReport(scope, payload.resumeId))
    expect(report.parse).toMatchObject({ status: 'succeeded', result: { draftCount: 1 }, costMicroUsd: 700 })
  })

  test("a parse cannot be run against another user's resume", async ({ db }) => {
    const payload = await uploaded(db)
    const intruder = await ensureUser(db, { email: `intruder-${randomUUID()}@test.local` })
    const { extract, calls } = stub()

    const result = await runResumeParse(db, { userId: intruder.id, resumeId: payload.resumeId }, extract)
    expect(!result.ok && result.error.code).toBe('not_found')
    expect(calls).toHaveLength(0)
  })
})
