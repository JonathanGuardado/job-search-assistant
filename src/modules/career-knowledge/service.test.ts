import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { dbErrorFrom, dbTest as test } from '@/lib/db/testing'
import { unwrap } from '@/lib/result'
import { ensureUser } from '@/modules/profiles'
import { completeParse, deleteResume, getLatestParse, getResume, startParse, uploadResume } from '@/modules/resumes'
import { careerItems } from './schema.js'
import {
  confirmCareerItem,
  discardDraft,
  prepareCareerItemsForResumeDeletion,
  listCareerItems,
  listGroundingItems,
  recordDrafts,
  saveCareerItem,
} from './service.js'
import { CareerItemEditSchema, type CareerItemDraft, type CareerItemEdit } from './types.js'

let storageRoot: string
let pdf: Uint8Array
beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'career-test-'))
  pdf = await readFile(new URL('../resumes/__fixtures__/synthetic-resume.pdf', import.meta.url))
})

function draft(overrides: Partial<CareerItemDraft> = {}): CareerItemDraft {
  return {
    type: 'role',
    organization: 'Acme Corp',
    title: 'Senior Backend Engineer',
    startedOn: '2020-03',
    endedOn: null,
    isCurrent: true,
    summary: null,
    achievements: ['Reduced p99 latency by 40% across the checkout service'],
    technologies: ['Node.js'],
    evidence: { achievements: [], technologies: [] },
    ...overrides,
  }
}

const asEdit = ({ evidence: _evidence, ...fields }: CareerItemDraft): CareerItemEdit => fields

/** A user with one uploaded resume and a parse run to attach drafts to. */
async function withDrafts(db: Db, drafts: CareerItemDraft[]) {
  const user = await ensureUser(db, { email: `career-${randomUUID()}@test.local` })
  const run = async <T>(work: (scope: TenantScope) => Promise<T>) => withTenant(db, user.id, work)
  const resumeId = await run(async (scope) => {
    const resume = unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
    const started = unwrap(await startParse(scope, { resumeId: resume.id, task: 't', taskVersion: 1 }))
    if (started.kind !== 'started') throw new Error('expected a started run')
    await recordDrafts(scope, { sourceResumeId: resume.id, sourceParseId: started.parseId, drafts })
    return resume.id
  })
  const items = await run((scope) => listCareerItems(scope, { sourceResumeId: resumeId }))
  return { user, run, resumeId, items }
}

describe('grounding invariant', () => {
  test('unverified drafts are never returned for grounding', async ({ db }) => {
    const { run, items } = await withDrafts(db, [draft(), draft({ organization: 'Globex S.A. de C.V.' })])
    expect(items.every((i) => !i.verifiedByUser)).toBe(true)
    expect(await run((scope) => listGroundingItems(scope))).toEqual([])

    const [first] = items
    if (!first) throw new Error('expected drafts')
    await run((scope) => confirmCareerItem(scope, first.id, asEdit(draft())))

    const grounding = await run((scope) => listGroundingItems(scope))
    expect(grounding.map((i) => i.id)).toEqual([first.id])
    expect(grounding[0]?.verifiedAt).toBeInstanceOf(Date)
  })

  test('saving a correction does not verify a draft', async ({ db }) => {
    const { run, items } = await withDrafts(db, [draft()])
    const saved = unwrap(await run((scope) => saveCareerItem(scope, items[0]?.id ?? '', asEdit(draft({ title: 'Staff Engineer' })))))
    expect(saved).toMatchObject({ title: 'Staff Engineer', verifiedByUser: false })
    expect(await run((scope) => listGroundingItems(scope))).toEqual([])
  })

  test('the database refuses verified_by_user without a verification time', async ({ db }) => {
    const { user, items } = await withDrafts(db, [draft()])
    const error = await dbErrorFrom(db, (d) =>
      withTenant(d, user.id, ({ db: tx }) => tx.update(careerItems).set({ verifiedByUser: true })),
    )
    expect(error).toContain('career_items_verified_check')
    expect(items).toHaveLength(1)
  })
})

describe('listCareerItems', () => {
  test('lists drafts from one parse in the order they appear in the resume', async ({ db }) => {
    const at = (start: number) => ({ start, end: start + 5, text: 'xxxxx' })
    const { items } = await withDrafts(db, [
      draft({ organization: 'Globex', evidence: { organization: at(300), achievements: [], technologies: [] } }),
      draft({ organization: 'Acme', evidence: { organization: at(40), achievements: [at(90)], technologies: [] } }),
      draft({ organization: 'Initech', evidence: { achievements: [at(120)], technologies: [] } }),
    ])
    expect(items.map((i) => i.organization)).toEqual(['Acme', 'Initech', 'Globex'])
  })
})

describe('review actions', () => {
  test('deleting a resume removes drafts and preserves confirmed grounding items and evidence', async ({ db }) => {
    const { run, resumeId, items } = await withDrafts(db, [draft(), draft({ organization: 'Globex' })])
    const first = items[0]
    if (!first) throw new Error('expected a draft')
    const confirmed = unwrap(await run((scope) => confirmCareerItem(scope, first.id, asEdit(draft()))))
    await run(async (scope) => {
      const parse = await getLatestParse(scope, resumeId)
      if (!parse) throw new Error('expected a parse')
      unwrap(await completeParse(scope, { parseId: parse.id, result: {}, traces: [] }))
      unwrap(await deleteResume(scope, resumeId, prepareCareerItemsForResumeDeletion))
    })
    expect(await run((scope) => listCareerItems(scope))).toEqual([{
      ...confirmed, sourceResumeId: null, sourceParseId: null,
    }])
    expect((await run((scope) => listGroundingItems(scope))).map((item) => item.id)).toEqual([confirmed.id])
    expect(await run((scope) => getLatestParse(scope, resumeId))).toBeNull()
  })

  test('refusing deletion during parsing leaves drafts untouched', async ({ db }) => {
    const { run, resumeId, items } = await withDrafts(db, [draft()])
    const result = await run((scope) => deleteResume(scope, resumeId, prepareCareerItemsForResumeDeletion))
    expect(!result.ok && result.error.code).toBe('conflict')
    expect(await run((scope) => listCareerItems(scope))).toEqual(items)
  })

  test('a failed deletion transaction restores the resume, parses, and drafts', async ({ db }) => {
    const { user, run, resumeId, items } = await withDrafts(db, [draft()])
    await run(async (scope) => {
      const parse = await getLatestParse(scope, resumeId)
      if (!parse) throw new Error('expected a parse')
      unwrap(await completeParse(scope, { parseId: parse.id, result: {}, traces: [] }))
    })
    const error = await dbErrorFrom(db, (executor) => withTenant(executor, user.id, async (scope) => {
      unwrap(await deleteResume(scope, resumeId, prepareCareerItemsForResumeDeletion))
      throw new Error('simulated commit failure')
    }))
    expect(error).toContain('simulated commit failure')
    expect((await run((scope) => getResume(scope, resumeId))).ok).toBe(true)
    expect(await run((scope) => getLatestParse(scope, resumeId))).toMatchObject({ status: 'succeeded' })
    expect(await run((scope) => listCareerItems(scope))).toEqual(items)
  })

  test('correcting a verified item keeps its first confirmation time', async ({ db }) => {
    const { run, items } = await withDrafts(db, [draft()])
    const id = items[0]?.id ?? ''
    const confirmed = unwrap(await run((scope) => confirmCareerItem(scope, id, asEdit(draft()))))
    const corrected = unwrap(await run((scope) => confirmCareerItem(scope, id, asEdit(draft({ title: 'Lead Engineer' })))))
    expect(corrected.title).toBe('Lead Engineer')
    expect(corrected.verifiedAt).toEqual(confirmed.verifiedAt)
  })

  test('a draft can be discarded; a confirmed item cannot', async ({ db }) => {
    const { run, items } = await withDrafts(db, [draft(), draft({ organization: 'Globex S.A. de C.V.' })])
    const [keep, drop] = items
    if (!keep || !drop) throw new Error('expected two drafts')
    await run((scope) => confirmCareerItem(scope, keep.id, asEdit(draft())))

    expect((await run((scope) => discardDraft(scope, drop.id))).ok).toBe(true)
    const refused = await run((scope) => discardDraft(scope, keep.id))
    expect(!refused.ok && refused.error.code).toBe('invalid_input')
    expect((await run((scope) => listCareerItems(scope))).map((i) => i.id)).toEqual([keep.id])
  })

  test('the database refuses a malformed partial date', async ({ db }) => {
    const { user, items } = await withDrafts(db, [draft()])
    const error = await dbErrorFrom(db, (d) =>
      withTenant(d, user.id, ({ db: tx }) => tx.update(careerItems).set({ startedOn: '2020-13' })),
    )
    expect(error).toContain('career_items_started_on_check')
    expect(items).toHaveLength(1)
  })
})

describe('CareerItemEditSchema', () => {
  const edit = asEdit(draft())

  it('rejects an end date on an ongoing entry', () => {
    expect(CareerItemEditSchema.safeParse({ ...edit, isCurrent: true, endedOn: '2023' }).success).toBe(false)
  })

  it('rejects an end before the start, comparing only the precision both dates state', () => {
    const base = { ...edit, isCurrent: false }
    expect(CareerItemEditSchema.safeParse({ ...base, startedOn: '2020-05', endedOn: '2019' }).success).toBe(false)
    expect(CareerItemEditSchema.safeParse({ ...base, startedOn: '2020-05', endedOn: '2020' }).success).toBe(true)
    expect(CareerItemEditSchema.safeParse({ ...base, startedOn: '2020', endedOn: '2020-02' }).success).toBe(true)
  })
})
