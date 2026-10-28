import { createHash } from 'node:crypto'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { logEvent } from '@/lib/log'
import { domainError, err, ok, type Result } from '@/lib/result'
import { callModel, type AiError, type CallModelSuccess } from '@/modules/ai'
import { listGroundingItems } from '@/modules/career-knowledge'
import type { FormQuestion } from '@/modules/job-sources'
import { getCandidateProfile } from '@/modules/profiles'
import { draftExperience, type WriteExperience } from './experience.js'
import { asksOwnWords, neverDrafted } from './never-drafted.js'
import { answerFromProfile, type ProfileFacts } from './profile-facts.js'
import { readQuestionsTask, type QuestionForReading } from './prompts/read-questions.js'
import { writeExperienceTask } from './prompts/write-experience.js'
import { RawReadingSchema, readingFrom, type QuestionReading } from './question-reading.js'
import { answerDrafts, questionReadings } from './schema.js'
import { jobsToApplyTo, newestDrafts, openQuestions, readinessForJobs, saveAnswer, type OpenQuestion } from './service.js'
import type { SavedAnswer, SaveAnswer } from './types.js'

/*
 * Drafting (decision 0014). A run takes the candidate's open questions, sets aside the ones
 * never drafted, reads what the rest ask (once per wording, for every candidate), drafts the
 * profile facts in code, and has experience answers written from confirmed career items and
 * checked (`experience.ts`, `grounding.ts`). Motivation drafts come next.
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
const textField = (question: FormQuestion) => question.fields.some((f) => f.type === 'text' || f.type === 'textarea')

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

/**
 * Written drafts stop for the day once a candidate's written drafts that day have cost this
 * much, in micro-USD (decision 0014; the owner raised it from US$0.20 to US$0.50 on
 * 2026-10-27). Readings and profile drafts do not count: they are bounded and shared.
 */
export const WRITTEN_DAILY_CAP_MICRO_USD = 500_000

const OWN_WORDS_REASON = 'This employer asks for answers in your own words, so no draft is written for it.'
const CHOICE_REASON = 'This question takes a choice, so it is yours to pick.'
const NO_ITEMS_REASON = 'Confirm your career items to get written drafts.'
const NOT_COVERED_REASON = 'Your confirmed career items do not cover what this question asks.'

export type DraftingDeps = { readonly read: ReadQuestions; readonly write: WriteExperience }
export type DraftingOptions = {
  readonly today?: Date
  /** "Draft now": only this question, and the daily cap does not apply. */
  readonly only?: string
}

export type DraftingOutcome = {
  /** Open questions that could take a draft, and how they fared. */
  readonly considered: number
  readonly neverDrafted: number
  readonly unread: number
  readonly drafted: number
  readonly noBasis: number
  /** Written drafts that failed the grounding check twice: stored with the reason, never offered. */
  readonly rejected: number
  readonly unchanged: number
  /** Written drafts left for another day: the daily cap was reached. */
  readonly capped: number
  /** Motivation questions, drafted from the next part of milestone 2.2. */
  readonly motivation: number
  readonly ownerOnly: number
}

type WrittenQuestion = { readonly question: OpenQuestion; readonly readingId: string; readonly inputsHash: string }

const startOfUtcDay = (day: Date) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))

async function writtenSpendSince(scope: TenantScope, since: Date): Promise<number> {
  const [row] = await scope.db.select({ total: sql<string>`coalesce(sum(${answerDrafts.costMicroUsd}), 0)` }).from(answerDrafts)
    .where(and(eq(answerDrafts.userId, scope.userId), inArray(answerDrafts.method, ['experience', 'motivation']), gte(answerDrafts.createdAt, since)))
  return Number(row?.total ?? 0)
}

/**
 * One drafting run for a candidate over the questions blocking the jobs the assistant works on,
 * most widely blocking first. Idempotent: a question whose draft would come out of the same
 * inputs as its newest one gets no new row, whatever that draft's outcome was.
 *
 * Profile facts and every no-model outcome are written in one short transaction. Written
 * drafts call the model outside any transaction and are stored one by one, until the day's cap.
 */
export async function draftAnswers(db: Db, userId: string, deps: DraftingDeps, options: DraftingOptions = {}): Promise<Result<DraftingOutcome>> {
  const today = options.today ?? new Date()
  const jobs = await jobsToApplyTo(db, userId)
  const readiness = await readinessForJobs(db, userId, jobs)
  const open = openQuestions(readiness)
    .filter((q) => q.answeredBy === 'saved_answer' && takesAnswer(q.question) && (options.only === undefined || q.questionKey === options.only))
  const draftable = open.filter((q) => neverDrafted(q.question) === null)
  const ownWordsJobs = new Set([...readiness]
    .filter(([, job]) => job.kind === 'assessed' && job.readiness.answers.some((a) => asksOwnWords(a.question)))
    .map(([jobId]) => jobId))
  const counts = {
    considered: open.length, neverDrafted: open.length - draftable.length, unread: 0, drafted: 0, noBasis: 0, rejected: 0, unchanged: 0, capped: 0, motivation: 0, ownerOnly: 0,
  }

  const readings = await readingsFor(db, draftable.map((q) => q.question), deps.read)
  if (!readings.ok) return readings

  const prepared = await withTenant(db, userId, async (scope) => {
    const profile = await getCandidateProfile(scope)
    if (!profile) return null
    const items = await listGroundingItems(scope)
    const facts: ProfileFacts = { profile, items, today }
    const newest = await newestDrafts(scope)
    const written: WrittenQuestion[] = []
    const store = (question: OpenQuestion, row: Omit<typeof answerDrafts.$inferInsert, 'userId' | 'questionKey' | 'label' | 'createdAt'>) =>
      scope.db.insert(answerDrafts).values({
        userId, questionKey: question.questionKey, label: question.label, ...row,
        // The moment of the write, not of the transaction: the newest draft must be the last one written.
        createdAt: sql`clock_timestamp()`,
      })

    for (const question of draftable) {
      const stored = readings.value.get(questionHash(question.question))
      if (!stored) { counts.unread++; continue }
      const { kind } = stored.reading
      if (kind === 'owner_only') { counts.ownerOnly++; continue }
      if (kind === 'motivation') { counts.motivation++; continue }

      if (kind === 'experience') {
        const reason = !textField(question.question) ? CHOICE_REASON
          : question.jobIds.some((id) => ownWordsJobs.has(id)) ? OWN_WORDS_REASON
            : items.length === 0 ? NO_ITEMS_REASON : null
        const inputsHash = digest({ reading: stored.id, task: writeExperienceTask.version, reason, items: items.map((i) => [i.id, i.updatedAt.toISOString()]) })
        if (newest.get(question.questionKey)?.inputsHash === inputsHash) { counts.unchanged++; continue }
        if (reason === null) { written.push({ question, readingId: stored.id, inputsHash }); continue }
        await store(question, { method: 'experience', inputsHash, readingId: stored.id, status: 'no_basis', answer: null, basis: { facts: [], itemIds: [] }, reason })
        counts.noBasis++
        continue
      }

      const draft = answerFromProfile(question.question, stored.reading, facts)
      if (!draft) continue
      const inputsHash = digest({ reading: stored.id, draft })
      if (newest.get(question.questionKey)?.inputsHash === inputsHash) { counts.unchanged++; continue }
      await store(question, {
        method: 'profile', inputsHash, readingId: stored.id,
        ...(draft.kind === 'drafted'
          ? { status: 'drafted', answer: draft.answer, basis: { facts: draft.basis, itemIds: draft.itemIds }, reason: null }
          : { status: 'no_basis', answer: null, basis: { facts: [], itemIds: [] }, reason: draft.reason }),
      })
      if (draft.kind === 'drafted') counts.drafted++
      else counts.noBasis++
    }
    return { items, written, spent: await writtenSpendSince(scope, startOfUtcDay(today)) }
  })
  if (!prepared) return ok({ ...counts, unread: draftable.length })

  let spent = prepared.spent
  for (const { question, readingId, inputsHash } of prepared.written) {
    if (options.only === undefined && spent >= WRITTEN_DAILY_CAP_MICRO_USD) { counts.capped++; continue }
    const result = await draftExperience(deps.write, question.question, prepared.items)
    if (!result.ok) return result
    const draft = result.value
    const cost = draft.traces.reduce((sum, t) => sum + t.costMicroUsd, 0)
    spent += cost
    await withTenant(db, userId, (scope) => scope.db.insert(answerDrafts).values({
      userId, questionKey: question.questionKey, label: question.label, method: 'experience', inputsHash, readingId,
      taskVersion: writeExperienceTask.version, traces: [...draft.traces], model: draft.traces.at(-1)?.model ?? null, costMicroUsd: cost,
      createdAt: sql`clock_timestamp()`,
      ...(draft.kind === 'drafted'
        ? { status: 'drafted', answer: { kind: 'text', text: draft.text }, basis: { facts: [...draft.quotes], itemIds: [...draft.itemIds] }, reason: null }
        : { status: draft.kind === 'rejected' ? 'rejected' : 'no_basis', answer: null, basis: { facts: [], itemIds: [] }, reason: draft.kind === 'rejected' ? draft.reason : NOT_COVERED_REASON }),
    }))
    if (draft.kind === 'drafted') counts.drafted++
    else if (draft.kind === 'rejected') counts.rejected++
    else counts.noBasis++
  }
  return ok(counts)
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
