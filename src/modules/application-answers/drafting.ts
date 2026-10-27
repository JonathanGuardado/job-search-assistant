import { createHash } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'
import { callModel, type AiError, type CallModelSuccess } from '@/modules/ai'
import { listGroundingItems } from '@/modules/career-knowledge'
import type { FormQuestion } from '@/modules/job-sources'
import { getCandidateProfile } from '@/modules/profiles'
import { neverDrafted } from './never-drafted.js'
import { answerFromProfile, type ProfileFacts } from './profile-facts.js'
import { readQuestionsTask, type QuestionForReading } from './prompts/read-questions.js'
import { isProfileReading, RawReadingSchema, readingFrom, type QuestionReading } from './question-reading.js'
import { answerDrafts, questionReadings } from './schema.js'
import { jobsToApplyTo, newestDrafts, openQuestions, readinessForJobs, saveAnswer } from './service.js'
import type { SavedAnswer, SaveAnswer } from './types.js'

/*
 * Drafting (decision 0014). A run takes the candidate's open questions, sets aside the ones
 * never drafted, reads what the rest ask (once per wording, for every candidate), and drafts
 * the profile facts in code. Experience and motivation drafts arrive with the grounding check.
 */

const ReadOutputSchema = z.object({ readings: z.array(RawReadingSchema) })
export type ReadQuestions = (input: { readonly questions: readonly QuestionForReading[] }) =>
  Promise<Result<CallModelSuccess<z.infer<typeof ReadOutputSchema>>, AiError>>

export const readQuestionsWithModel: ReadQuestions = (input) => callModel({ task: readQuestionsTask, schema: ReadOutputSchema, input })

/** Small enough that one bad batch loses little, large enough that 250 questions take ten calls. */
const READ_BATCH = 25

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** A question is the same question wherever its wording, description, fields and options are. */
export const questionHash = (question: FormQuestion) =>
  digest([question.label.trim(), question.description ?? '', question.fields.map((f) => [f.type, f.options.map((o) => o.label)])])

const optionLabels = (question: FormQuestion) => question.fields.flatMap((f) => f.options.map((o) => o.label)).slice(0, 40)
const takesAnswer = (question: FormQuestion) => question.fields.some((f) => f.type !== 'file' && f.type !== 'hidden')

type StoredReading = { readonly id: string; readonly reading: QuestionReading }

/**
 * What each question asks, keyed by question hash: stored readings first, the model for the
 * rest. A batch the model fails is logged and left unread, never guessed; `rate_limited` and
 * `upstream_failed` stop the run so the queue retries it.
 */
async function readingsFor(db: Db, questions: readonly FormQuestion[], read: ReadQuestions): Promise<Result<Map<string, StoredReading>>> {
  const byHash = new Map(questions.map((q) => [questionHash(q), q]))
  const stored = new Map<string, StoredReading>()
  const hashes = [...byHash.keys()]
  for (let i = 0; i < hashes.length; i += 500) {
    const rows = await db.select().from(questionReadings)
      .where(and(inArray(questionReadings.questionHash, hashes.slice(i, i + 500)), eq(questionReadings.taskVersion, readQuestionsTask.version)))
    for (const row of rows) stored.set(row.questionHash, { id: row.id, reading: row.reading })
  }

  const unread = hashes.filter((hash) => !stored.has(hash))
  for (let i = 0; i < unread.length; i += READ_BATCH) {
    const batch = new Map(unread.slice(i, i + READ_BATCH).map((hash, n) => [`q${n + 1}`, hash]))
    const result = await read({
      questions: [...batch].map(([id, hash]) => {
        const question = byHash.get(hash)
        return { id, label: question?.label ?? '', description: question?.description ?? null, options: question ? optionLabels(question) : [] }
      }),
    })
    if (!result.ok) {
      if (result.error.code === 'rate_limited' || result.error.code === 'upstream_failed') return err(domainError(result.error.code, result.error.message))
      logEvent('application_answers.read_failed', { code: result.error.code, questions: batch.size })
      continue
    }
    const { traces } = result.value
    const share = Math.floor(traces.reduce((sum, t) => sum + t.costMicroUsd, 0) / Math.max(1, result.value.value.readings.length))
    for (const raw of result.value.value.readings) {
      const hash = batch.get(raw.id)
      if (!hash || stored.has(hash)) continue
      const reading = readingFrom(raw)
      const [row] = await db.insert(questionReadings).values({
        questionHash: hash, taskVersion: readQuestionsTask.version, reading, traces: [...traces], model: traces.at(-1)?.model ?? null, costMicroUsd: share,
      }).onConflictDoNothing().returning({ id: questionReadings.id })
      const id = row?.id ?? (await db.select({ id: questionReadings.id }).from(questionReadings)
        .where(and(eq(questionReadings.questionHash, hash), eq(questionReadings.taskVersion, readQuestionsTask.version))))[0]?.id
      if (id) stored.set(hash, { id, reading })
    }
  }
  return ok(stored)
}

export type DraftingOutcome = {
  /** Open questions that could take a draft, and how they fared. */
  readonly considered: number
  readonly neverDrafted: number
  readonly unread: number
  readonly drafted: number
  readonly noBasis: number
  readonly unchanged: number
  /** Experience and motivation questions, drafted from milestone 2.2's second part. */
  readonly written: number
  readonly ownerOnly: number
}

/**
 * One drafting run for a candidate over the questions blocking the jobs the assistant works on.
 * Idempotent: a question whose draft would come out the same as its newest one gets no new row.
 */
export async function draftAnswers(db: Db, userId: string, read: ReadQuestions, today: Date = new Date()): Promise<Result<DraftingOutcome>> {
  const jobs = await jobsToApplyTo(db, userId)
  const open = openQuestions(await readinessForJobs(db, userId, jobs)).filter((q) => q.answeredBy === 'saved_answer' && takesAnswer(q.question))
  const draftable = open.filter((q) => neverDrafted(q.question) === null)
  const counts = { considered: open.length, neverDrafted: open.length - draftable.length, unread: 0, drafted: 0, noBasis: 0, unchanged: 0, written: 0, ownerOnly: 0 }

  const readings = await readingsFor(db, draftable.map((q) => q.question), read)
  if (!readings.ok) return readings

  return withTenant(db, userId, async (scope) => {
    const profile = await getCandidateProfile(scope)
    if (!profile) return ok({ ...counts, unread: draftable.length })
    const facts: ProfileFacts = { profile, items: await listGroundingItems(scope), today }
    const newest = await newestDrafts(scope)

    for (const question of draftable) {
      const stored = readings.value.get(questionHash(question.question))
      if (!stored) { counts.unread++; continue }
      if (stored.reading.kind === 'owner_only') { counts.ownerOnly++; continue }
      if (!isProfileReading(stored.reading.kind)) { counts.written++; continue }
      const draft = answerFromProfile(question.question, stored.reading, facts)
      if (!draft) continue
      const inputsHash = digest({ reading: stored.id, draft })
      if (newest.get(question.questionKey)?.inputsHash === inputsHash) { counts.unchanged++; continue }
      await scope.db.insert(answerDrafts).values({
        userId, questionKey: question.questionKey, label: question.label, method: 'profile', inputsHash, readingId: stored.id,
        // The moment of the write, not of the transaction: the newest draft must be the last one written.
        createdAt: sql`clock_timestamp()`,
        ...(draft.kind === 'drafted'
          ? { status: 'drafted', answer: draft.answer, basis: { facts: draft.basis, itemIds: draft.itemIds }, reason: null }
          : { status: 'no_basis', answer: null, basis: { facts: [], itemIds: [] }, reason: draft.reason }),
      })
      if (draft.kind === 'drafted') counts.drafted++
      else counts.noBasis++
    }
    return ok(counts)
  })
}

/**
 * The candidate accepts a draft, as drafted or edited: it becomes their saved answer to the
 * question, marked as coming from that draft (decision 0014).
 */
export async function acceptDraft(scope: TenantScope, input: { readonly draftId: string; readonly answer?: SaveAnswer['answer'] }): Promise<Result<SavedAnswer>> {
  const [draft] = await scope.db.select().from(answerDrafts).where(and(eq(answerDrafts.userId, scope.userId), eq(answerDrafts.id, input.draftId)))
  if (!draft) return err(domainError('not_found', 'That draft was not found.'))
  // An answer to a question with no draft is the candidate's own: it goes through saveAnswer.
  if (draft.status !== 'drafted' || !draft.answer) return err(domainError('invalid_input', 'That question has no draft to accept.'))
  const answer = input.answer ?? (draft.answer.kind === 'choice' ? { kind: 'choice' as const, labels: [...draft.answer.labels] } : draft.answer)
  return saveAnswer(scope, { label: draft.label, answer }, { origin: 'draft', draftId: draft.id })
}
