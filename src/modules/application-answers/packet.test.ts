import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect } from 'vitest'
import { withTenant } from '@/lib/db/tenancy'
import { dbTest as test } from '@/lib/db/testing'
import { unwrap } from '@/lib/result'
import { createApplication } from '@/modules/applications'
import { getJobRawVersion } from '@/modules/jobs'
import { uploadResume } from '@/modules/resumes'
import { buildPacket } from './packet.js'
import { questionKey } from './readiness.js'
import { answerDrafts } from './schema.js'
import { saveAnswer, saveApplicantDetails } from './service.js'
import { aBoard, aCandidate, aJob, makeEligible, storeForm, writtenQuestion } from './test-fixtures.js'

const PYTHON = 'Describe your Python development experience'
const AGREEMENTS = 'Are you subject to any employment agreements and/or post-employment restrictions with your current employer or a past employer?'
const details = { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', phone: '+503 7000 0000', linkedinUrl: null, githubUrl: null, websiteUrl: null }

/** A candidate with details and a resume, and a GitLab job they can apply to whose form adds PYTHON. */
async function setUp(db: Parameters<typeof aCandidate>[0]) {
  const userId = await aCandidate(db)
  const job = await aJob(db, await aBoard(db), 'Backend Engineer')
  await storeForm(db, job, 'gitlab', [writtenQuestion(PYTHON)])
  await makeEligible(db, userId, job)
  const pdf = await readFile(new URL('../resumes/__fixtures__/synthetic-resume.pdf', import.meta.url))
  const storageRoot = await mkdtemp(join(tmpdir(), 'packet-test-'))
  const resume = await withTenant(db, userId, async (scope) => {
    unwrap(await saveApplicantDetails(scope, details))
    return unwrap(await uploadResume(scope, { filename: 'cv.pdf', bytes: pdf }, { storageRoot }))
  })
  return { userId, job, resume }
}

describe('the packet: everything the browser will enter, fixed at review (decision 0016)', () => {
  test('refuses a job the candidate cannot apply to, one they applied to, and one with no stored form', async ({ db }) => {
    const { userId, job } = await setUp(db)
    const notEligible = await aJob(db, await aBoard(db), 'Platform Engineer')
    await storeForm(db, notEligible, 'gitlab')
    expect(await buildPacket(db, userId, notEligible.id)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })

    const noForm = await aJob(db, await aBoard(db), 'Site Reliability Engineer')
    await makeEligible(db, userId, noForm)
    expect(await buildPacket(db, userId, noForm.id)).toMatchObject({ ok: false, error: { code: 'not_found' } })

    await withTenant(db, userId, async (scope) => unwrap(await createApplication(scope, {
      jobId: job.id, appliedOn: '2026-10-28', resumeId: null, salaryAsked: null, contact: null, notes: null, sourceUrl: null,
    })))
    expect(await buildPacket(db, userId, job.id)).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })

  test('lists every question: what is filled, from where, and what is left to the owner', async ({ db }) => {
    const { userId, job, resume } = await setUp(db)
    await withTenant(db, userId, async (scope) => {
      const [draft] = await scope.db.insert(answerDrafts).values({
        userId, questionKey: questionKey(PYTHON), label: PYTHON, method: 'experience', status: 'drafted',
        answer: { kind: 'text', text: 'I built the payments API in Python.' }, basis: { facts: [], itemIds: [] }, inputsHash: 'test',
      }).returning({ id: answerDrafts.id })
      unwrap(await saveAnswer(scope, { label: PYTHON, answer: { kind: 'text', text: 'I built the payments API in Python.' } }, { origin: 'draft', draftId: draft?.id ?? null }))
      unwrap(await saveAnswer(scope, { label: AGREEMENTS, answer: { kind: 'choice', labels: ['No'] } }))
    })

    const packet = unwrap(await buildPacket(db, userId, job.id))
    expect(packet).toMatchObject({ jobId: job.id, rawJobId: unwrap(await getJobRawVersion(db, job.id)), resume: { id: resume.id, sha256: resume.contentSha256 } })
    const item = (label: string) => packet.items.find((i) => i.label === label)
    expect(item('First Name')).toEqual({ kind: 'fill', questionKey: questionKey('First Name'), label: 'First Name', required: true, field: 'first_name', value: { kind: 'text', text: 'Ana' }, source: 'details', origin: null })
    expect(item('Resume/CV')).toMatchObject({ kind: 'fill', field: 'resume', value: { kind: 'file', resumeId: resume.id }, source: 'resume' })
    expect(item(PYTHON)).toMatchObject({ kind: 'fill', source: 'saved', origin: 'written_draft', value: { kind: 'text', text: 'I built the payments API in Python.' } })
    // A choice carries the form's own option value, what the form submits.
    expect(item(AGREEMENTS)).toMatchObject({ kind: 'fill', source: 'saved', origin: 'owner', value: { kind: 'choice', options: [{ label: 'No', value: expect.stringMatching(/^\d+$/) }] } })
    expect(item('What is your current country of residence?')).toMatchObject({ kind: 'fill', source: 'profile', value: { kind: 'choice', options: [{ label: 'El Salvador' }] } })
    // Required and unanswered: left to the owner, with the reason. Optional and unanswered: left empty.
    expect(item('Have you previously worked at or consulted for GitLab?')).toMatchObject({ kind: 'unresolved', reason: 'unanswered' })
    expect(item('Cover Letter')).toMatchObject({ kind: 'empty' })
  })

  test('its fingerprint changes when anything it would enter changes, and only then', async ({ db }) => {
    const { userId, job } = await setUp(db)
    const first = unwrap(await buildPacket(db, userId, job.id))
    expect(unwrap(await buildPacket(db, userId, job.id)).fingerprint).toBe(first.fingerprint)
    await withTenant(db, userId, async (scope) => unwrap(await saveAnswer(scope, { label: AGREEMENTS, answer: { kind: 'choice', labels: ['No'] } })))
    const second = unwrap(await buildPacket(db, userId, job.id))
    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(second.formFingerprint).toBe(first.formFingerprint)
  })
})
