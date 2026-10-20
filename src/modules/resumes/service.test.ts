import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect } from 'vitest'
import type { Db } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { dbErrorFrom, dbTest as test } from '@/lib/db/testing'
import { unwrap } from '@/lib/result'
import type { ModelTrace } from '@/modules/ai'
import { ensureUser } from '@/modules/profiles'
import { resumes } from './schema.js'
import {
  completeParse,
  deleteResume,
  failParse,
  getLatestParse,
  getResume,
  listResumes,
  removeUnusedResumeFile,
  startParse,
  uploadResume,
} from './service.js'

let storageRoot: string
let pdf: Uint8Array
let docx: Uint8Array
beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'resumes-test-'))
  pdf = await readFile(new URL('./__fixtures__/synthetic-resume.pdf', import.meta.url))
  docx = await readFile(new URL('./__fixtures__/synthetic-resume.docx', import.meta.url))
})

describe('resume deletion', () => {
  const noDrafts = async () => {}

  test('deletes a failed resume and its parses before removing its file', async ({ db }) => {
    const user = await aUser(db)
    const resume = await withTenant(db, user.id, async (scope) => {
      const uploaded = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
      const started = unwrap(await startParse(scope, { resumeId: uploaded.id, ...task }))
      if (started.kind !== 'started') throw new Error('expected a started run')
      await failParse(scope, { parseId: started.parseId, errorCode: 'upstream_failed', errorMessage: 'unavailable', traces: [] })
      return uploaded
    })
    const key = unwrap(await withTenant(db, user.id, (scope) => deleteResume(scope, resume.id, noDrafts)))
    expect(await withTenant(db, user.id, (scope) => listResumes(scope))).toEqual([])
    expect(await withTenant(db, user.id, (scope) => getLatestParse(scope, resume.id))).toBeNull()
    expect(await readFile(join(storageRoot, key))).toEqual(Buffer.from(pdf))
    unwrap(await withTenant(db, user.id, (scope) => removeUnusedResumeFile(scope, key, storageRoot)))
    await expect(readFile(join(storageRoot, key))).rejects.toMatchObject({ code: 'ENOENT' })
    // Retried cleanup is harmless if the file has already gone.
    expect((await withTenant(db, user.id, (scope) => removeUnusedResumeFile(scope, key, storageRoot))).ok).toBe(true)
  })

  test('keeps a shared file until the last version is deleted', async ({ db }) => {
    const user = await aUser(db)
    const versions = await withTenant(db, user.id, async (scope) => [
      unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot })),
      unwrap(await uploadResume(scope, { filename: 'copy.pdf', bytes: pdf }, { storageRoot })),
    ])
    for (const [index, resume] of versions.entries()) {
      const key = unwrap(await withTenant(db, user.id, (scope) => deleteResume(scope, resume.id, noDrafts)))
      unwrap(await withTenant(db, user.id, (scope) => removeUnusedResumeFile(scope, key, storageRoot)))
      if (index === 0) expect(await readFile(join(storageRoot, key))).toEqual(Buffer.from(pdf))
      else await expect(readFile(join(storageRoot, key))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  test('refuses deletion while any parse is running, even if the latest parse failed', async ({ db }) => {
    const user = await aUser(db)
    await withTenant(db, user.id, async (scope) => {
      const resume = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
      await startParse(scope, { resumeId: resume.id, ...task })
      const newer = unwrap(await startParse(scope, { resumeId: resume.id, task: 'newer', taskVersion: 1 }))
      if (newer.kind !== 'started') throw new Error('expected a started run')
      await failParse(scope, { parseId: newer.parseId, errorCode: 'upstream_failed', errorMessage: 'unavailable', traces: [] })
      const result = await deleteResume(scope, resume.id, async () => { throw new Error('draft cleanup must not run') })
      expect(!result.ok && result.error.code).toBe('conflict')
      expect((await getResume(scope, resume.id)).ok).toBe(true)
      expect(await readFile(join(storageRoot, resume.storageKey))).toEqual(Buffer.from(pdf))
    })
  })

  test('cannot delete another tenant\'s resume or a missing resume', async ({ db }) => {
    const owner = await aUser(db)
    const other = await aUser(db)
    const resume = unwrap(await withTenant(db, owner.id, (scope) =>
      uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }),
    ))
    for (const id of [resume.id, randomUUID()]) {
      const result = await withTenant(db, other.id, (scope) => deleteResume(scope, id, noDrafts))
      expect(!result.ok && result.error.code).toBe('not_found')
    }
    const cleanup = await withTenant(db, other.id, (scope) =>
      removeUnusedResumeFile(scope, resume.storageKey, storageRoot),
    )
    expect(!cleanup.ok && cleanup.error.code).toBe('invalid_input')
    expect(await readFile(join(storageRoot, resume.storageKey))).toEqual(Buffer.from(pdf))
    expect((await withTenant(db, owner.id, (scope) => getResume(scope, resume.id))).ok).toBe(true)
  })

  test('refuses to delete a parent while a derived version exists', async ({ db }) => {
    const user = await aUser(db)
    await withTenant(db, user.id, async (scope) => {
      const resume = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
      const { id: _id, createdAt: _createdAt, ...columns } = resume
      await scope.db.insert(resumes).values({
        ...columns, version: 2, parentId: resume.id, isMaster: false, extractedText: 'Synthetic test text',
      })
      const result = await deleteResume(scope, resume.id, noDrafts)
      expect(!result.ok && result.error.code).toBe('conflict')
      expect(await listResumes(scope)).toHaveLength(2)
    })
  })
})

const aUser = (db: Db) => ensureUser(db, { email: `resume-${randomUUID()}@test.local` })
const task = { task: 'test.parse', taskVersion: 1 }

function trace(costMicroUsd: number): ModelTrace {
  return {
    task: 'test.parse', taskVersion: 1, provider: 'fake', model: 'fake-model', attempt: 1,
    stopReason: 'stop', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0,
    costMicroUsd, latencyMs: 1, rawOutput: '{}', validationError: null,
  }
}

describe('resume versions', () => {
  test('each upload is a new master version with its file stored and text extracted', async ({ db }) => {
    const user = await aUser(db)
    const [first, second] = await withTenant(db, user.id, async (scope) => [
      unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot })),
      unwrap(await uploadResume(scope, { filename: 'cv.docx', bytes: docx }, { storageRoot })),
    ])

    expect([first?.version, second?.version]).toEqual([1, 2])
    expect(first).toMatchObject({ isMaster: true, parentId: null, contentType: 'application/pdf' })
    expect(await readFile(join(storageRoot, first?.storageKey ?? ''))).toEqual(Buffer.from(pdf))

    const listed = await withTenant(db, user.id, (scope) => listResumes(scope))
    expect(listed.map((r) => [r.version, r.latestParse])).toEqual([[2, null], [1, null]])

    const withText = await withTenant(db, user.id, (scope) => getResume(scope, first?.id ?? ''))
    expect(withText.ok && withText.value.extractedText).toContain('Acme Corp')
  })

  test('re-uploading identical bytes makes a new version sharing one stored file', async ({ db }) => {
    const user = await aUser(db)
    const [a, b] = await withTenant(db, user.id, async (scope) => [
      unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot })),
      unwrap(await uploadResume(scope, { filename: 'cv-again.pdf', bytes: pdf }, { storageRoot })),
    ])
    expect(b?.version).toBe(2)
    expect(b?.storageKey).toBe(a?.storageKey)
  })

  test('the database refuses to edit a version in place', async ({ db }) => {
    const user = await aUser(db)
    await withTenant(db, user.id, (scope) =>
      uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }),
    )
    const error = await dbErrorFrom(db, (d) =>
      withTenant(d, user.id, ({ db: tx }) => tx.update(resumes).set({ filename: 'edited.pdf' })),
    )
    expect(error).toContain('permission denied')
  })

  test('rejects unsupported and oversized files without creating a version', async ({ db }) => {
    const user = await aUser(db)
    const results = await withTenant(db, user.id, async (scope) => [
      await uploadResume(scope, { filename: 'cv.txt', bytes: new TextEncoder().encode('plain text') }, { storageRoot }),
      await uploadResume(scope, { filename: 'huge.pdf', bytes: new Uint8Array(5 * 1024 * 1024 + 1) }, { storageRoot }),
    ])
    expect(results.map((r) => !r.ok && r.error.code)).toEqual(['invalid_input', 'invalid_input'])
    expect(await withTenant(db, user.id, (scope) => listResumes(scope))).toEqual([])
  })

  test("another user cannot see a user's resume", async ({ db }) => {
    const owner = await aUser(db)
    const other = await aUser(db)
    const resume = await withTenant(db, owner.id, async (scope) =>
      unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot })),
    )
    const seen = await withTenant(db, other.id, (scope) => getResume(scope, resume.id))
    expect(!seen.ok && seen.error.code).toBe('not_found')
  })
})

describe('parse runs', () => {
  test('a succeeded run is never restarted or completed twice', async ({ db }) => {
    const user = await aUser(db)
    await withTenant(db, user.id, async (scope) => {
      const resume = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
      const started = unwrap(await startParse(scope, { resumeId: resume.id, ...task }))
      expect(started.kind).toBe('started')
      if (started.kind !== 'started') return

      expect((await completeParse(scope, { parseId: started.parseId, result: { n: 1 }, traces: [trace(50)] })).ok).toBe(true)
      expect(unwrap(await startParse(scope, { resumeId: resume.id, ...task }))).toEqual({ kind: 'already_succeeded' })
      const again = await completeParse(scope, { parseId: started.parseId, result: { n: 2 }, traces: [] })
      expect(!again.ok && again.error.code).toBe('conflict')

      expect(await getLatestParse(scope, resume.id)).toMatchObject({
        status: 'succeeded', result: { n: 1 }, costMicroUsd: 50, model: 'fake-model',
      })
    })
  })

  test('a failed run resumes on the same row and keeps the cost of every attempt', async ({ db }) => {
    const user = await aUser(db)
    await withTenant(db, user.id, async (scope) => {
      const resume = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
      const first = unwrap(await startParse(scope, { resumeId: resume.id, ...task }))
      if (first.kind !== 'started') throw new Error('expected a started run')
      await failParse(scope, { parseId: first.parseId, errorCode: 'validation_failed', errorMessage: 'bad', traces: [trace(30), trace(30)] })

      const second = unwrap(await startParse(scope, { resumeId: resume.id, ...task }))
      expect(second).toMatchObject({ kind: 'started', parseId: first.parseId })
      await completeParse(scope, { parseId: first.parseId, result: {}, traces: [trace(40)] })

      const parse = await getLatestParse(scope, resume.id)
      expect(parse).toMatchObject({ status: 'succeeded', costMicroUsd: 100, errorCode: null })
      expect(parse?.traces).toHaveLength(3)
    })
  })

  test('a new task version gets its own run', async ({ db }) => {
    const user = await aUser(db)
    await withTenant(db, user.id, async (scope) => {
      const resume = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
      const v1 = unwrap(await startParse(scope, { resumeId: resume.id, ...task }))
      if (v1.kind === 'started') await completeParse(scope, { parseId: v1.parseId, result: {}, traces: [] })
      const v2 = unwrap(await startParse(scope, { resumeId: resume.id, task: 'test.parse', taskVersion: 2 }))
      expect(v2.kind).toBe('started')
    })
  })

  test('starting a parse for a missing resume is not_found', async ({ db }) => {
    const user = await aUser(db)
    const result = await withTenant(db, user.id, (scope) => startParse(scope, { resumeId: randomUUID(), ...task }))
    expect(!result.ok && result.error.code).toBe('not_found')
  })
})
