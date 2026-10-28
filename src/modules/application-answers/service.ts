import { createHash } from 'node:crypto'
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { logEvent } from '@/lib/log'
import { connectRedis } from '@/lib/queue'
import { domainError, err, ok, type Result } from '@/lib/result'
import { callModel, type AiError, type CallModelSuccess } from '@/modules/ai'
import { listAssessments, reviewGroup } from '@/modules/eligibility'
import { applicationFormFetchKey, applicationFormFetchQueue, getApplicationForms, postingKey, sourcePublishesForms, type FormQuestion } from '@/modules/job-sources'
import { getJob, getJobRawVersion, getJobs, listJobUserStates, type Job } from '@/modules/jobs'
import { listMatches } from '@/modules/matching'
import { getCandidateProfile } from '@/modules/profiles'
import { listResumes } from '@/modules/resumes'
import { matchQuestionsTask, type QuestionForMatching } from './prompts/match-questions.js'
import { assessReadiness, questionKey, standardField, type FilledValue, type Readiness, type ReadinessInput } from './readiness.js'
import { neverDrafted, type NeverDrafted } from './never-drafted.js'
import { answerDrafts, applicantDetails, questionMatchRuns, savedAnswers } from './schema.js'
import type { AnswerDraft, ApplicantDetails, SaveAnswer, SavedAnswer } from './types.js'

// ---------------------------------------------------------------------------
// The candidate's details and saved answers

export async function getApplicantDetails(scope: TenantScope): Promise<ApplicantDetails | null> {
  const [row] = await scope.db.select().from(applicantDetails).where(eq(applicantDetails.userId, scope.userId))
  if (!row) return null
  const { firstName, lastName, email, phone, linkedinUrl, githubUrl, websiteUrl } = row
  return { firstName, lastName, email, phone, linkedinUrl, githubUrl, websiteUrl }
}

export async function saveApplicantDetails(scope: TenantScope, input: ApplicantDetails): Promise<Result<ApplicantDetails>> {
  await scope.db.insert(applicantDetails).values({ userId: scope.userId, ...input })
    .onConflictDoUpdate({ target: applicantDetails.userId, set: { ...input, updatedAt: sql`now()` } })
  return ok(input)
}

export async function listSavedAnswers(scope: TenantScope): Promise<SavedAnswer[]> {
  const rows = await scope.db.select().from(savedAnswers).where(eq(savedAnswers.userId, scope.userId)).orderBy(desc(savedAnswers.updatedAt))
  return rows.map(toSavedAnswer)
}

const toSavedAnswer = ({ questionKey: key, jobId, label, answer, origin, updatedAt }: typeof savedAnswers.$inferSelect): SavedAnswer =>
  ({ questionKey: key, jobId, label, answer, origin, updatedAt })

const forJob = (jobId: string | null) => (jobId === null ? isNull(savedAnswers.jobId) : eq(savedAnswers.jobId, jobId))

/** Where an answer came from, when it was not written by the candidate (decision 0014). */
type Provenance = { readonly origin: 'owner' } | { readonly origin: 'draft'; readonly draftId: string | null }

/**
 * Saves the candidate's answer to a question as worded, for every job or for one, replacing
 * an earlier answer to the same question for the same jobs. Written by the candidate unless
 * `provenance` says it came from a draft.
 */
export async function saveAnswer(scope: TenantScope, input: SaveAnswer, provenance: Provenance = { origin: 'owner' }): Promise<Result<SavedAnswer>> {
  const key = questionKey(input.label)
  if (key === '') return err(domainError('invalid_input', 'The question has no text.'))
  const source = { origin: provenance.origin, draftId: provenance.origin === 'draft' ? provenance.draftId : null }
  const jobId = input.jobId ?? null
  const [row] = await scope.db.insert(savedAnswers).values({ userId: scope.userId, questionKey: key, jobId, label: input.label, answer: input.answer, ...source })
    .onConflictDoUpdate({ target: [savedAnswers.userId, savedAnswers.questionKey, savedAnswers.jobId], set: { answer: input.answer, ...source, updatedAt: sql`now()` } })
    .returning()
  if (!row) throw new Error('saved answer upsert returned no row')
  return ok(toSavedAnswer(row))
}

/** Deletes the answer to a question for every job (`jobId` null) or for one job; the other stays. */
export async function deleteSavedAnswer(scope: TenantScope, key: string, jobId: string | null = null): Promise<Result<void>> {
  const deleted = await scope.db.delete(savedAnswers)
    .where(and(eq(savedAnswers.userId, scope.userId), eq(savedAnswers.questionKey, key), forJob(jobId))).returning({ id: savedAnswers.id })
  return deleted.length > 0 ? ok(undefined) : err(domainError('not_found', 'That saved answer was not found.'))
}

// ---------------------------------------------------------------------------
// Drafts (decision 0014; made in drafting.ts)

type DraftRow = typeof answerDrafts.$inferSelect

const toDraft = (row: DraftRow): AnswerDraft => ({
  id: row.id, questionKey: row.questionKey, jobId: row.jobId, label: row.label, method: row.method, status: row.status,
  answer: row.answer, basis: row.basis, reason: row.reason, createdAt: row.createdAt,
})

/** The newest draft for each question that serves every job (motivation drafts are per job). */
export async function newestDrafts(scope: TenantScope): Promise<Map<string, DraftRow>> {
  const rows = await scope.db.selectDistinctOn([answerDrafts.questionKey]).from(answerDrafts)
    .where(and(eq(answerDrafts.userId, scope.userId), isNull(answerDrafts.jobId)))
    .orderBy(answerDrafts.questionKey, desc(answerDrafts.createdAt))
  return new Map(rows.map((row) => [row.questionKey, row]))
}

export async function latestDrafts(scope: TenantScope): Promise<Map<string, AnswerDraft>> {
  return new Map([...(await newestDrafts(scope))].map(([key, row]) => [key, toDraft(row)]))
}

/** Map key for a draft written for one job. */
export const jobDraftKey = (jobId: string, key: string) => `${jobId} ${key}`

/** The newest draft for each question of each job it was written for (motivation), by `jobDraftKey`. */
export async function newestJobDrafts(scope: TenantScope): Promise<Map<string, DraftRow>> {
  const rows = await scope.db.selectDistinctOn([answerDrafts.jobId, answerDrafts.questionKey]).from(answerDrafts)
    .where(and(eq(answerDrafts.userId, scope.userId), isNotNull(answerDrafts.jobId)))
    .orderBy(answerDrafts.jobId, answerDrafts.questionKey, desc(answerDrafts.createdAt))
  return new Map(rows.flatMap((row) => (row.jobId ? [[jobDraftKey(row.jobId, row.questionKey), row] as const] : [])))
}

// ---------------------------------------------------------------------------
// Readiness

/** An answer the candidate gave to a differently worded question, offered for this one. Never used until accepted. */
export type Suggestion = { readonly savedQuestionKey: string; readonly savedLabel: string; readonly value: FilledValue }

export type JobReadiness =
  /** The job's source publishes no structured form (Lever, for now). */
  | { readonly kind: 'unsupported' }
  /** The form has not been fetched yet. */
  | { readonly kind: 'not_fetched' }
  | {
    readonly kind: 'assessed'; readonly readiness: Readiness; readonly fetchedAt: Date
    readonly suggestions: ReadonlyMap<string, Suggestion>
    /** The newest draft for each blocking question, or why it has none. Never used until accepted. */
    readonly drafts: ReadonlyMap<string, AnswerDraft>
  }

type JobRef = Pick<Job, 'id' | 'sourceId' | 'externalId'>

type CandidateInputs = {
  /** With the general saved answers only; a job's own answers are added for that job. */
  readonly input: ReadinessInput
  /** Answers for every job: the only ones offered for other questions. */
  readonly saved: SavedAnswer[]
  readonly jobSaved: ReadonlyMap<string, SavedAnswer[]>
  readonly matches: Readonly<Record<string, string>>
  readonly drafts: ReadonlyMap<string, AnswerDraft>
  /** By `jobDraftKey`. */
  readonly jobDrafts: ReadonlyMap<string, AnswerDraft>
}

async function candidateInputs(db: Db, userId: string): Promise<CandidateInputs> {
  return withTenant(db, userId, async (scope) => {
    const [details, resumes, profile, allSaved, drafts, jobDrafts, [run]] = await Promise.all([
      getApplicantDetails(scope), listResumes(scope), getCandidateProfile(scope), listSavedAnswers(scope), latestDrafts(scope), newestJobDrafts(scope),
      scope.db.select({ matches: questionMatchRuns.matches }).from(questionMatchRuns)
        .where(and(eq(questionMatchRuns.userId, scope.userId), eq(questionMatchRuns.taskVersion, matchQuestionsTask.version)))
        .orderBy(desc(questionMatchRuns.createdAt)).limit(1),
    ])
    const newest = resumes[0]
    const saved = allSaved.filter((s) => s.jobId === null)
    const jobSaved = new Map<string, SavedAnswer[]>()
    for (const answer of allSaved) if (answer.jobId !== null) jobSaved.set(answer.jobId, [...(jobSaved.get(answer.jobId) ?? []), answer])
    return {
      input: {
        details, profile: profile ? { country: profile.country, city: profile.city } : null, savedAnswers: saved,
        resume: newest ? { id: newest.id, label: `Version ${newest.version} · ${newest.filename}` } : null,
      },
      saved,
      jobSaved,
      matches: run?.matches ?? {},
      drafts,
      jobDrafts: new Map([...jobDrafts].map(([key, row]) => [key, toDraft(row)])),
    }
  })
}

/** The value a saved answer would give this question, if this question's fields can take it. */
function suggestionFor(question: FormQuestion, saved: SavedAnswer, input: ReadinessInput): Suggestion | null {
  const reused = { ...saved, questionKey: questionKey(question.label) }
  const [answer] = assessReadiness({ questions: [question] }, { ...input, savedAnswers: [reused] }).answers
  return answer?.source === 'saved' && answer.value ? { savedQuestionKey: saved.questionKey, savedLabel: saved.label, value: answer.value } : null
}

function readinessFrom(jobs: readonly JobRef[], forms: Awaited<ReturnType<typeof getApplicationForms>>, supported: ReadonlySet<string>, inputs: CandidateInputs): Map<string, JobReadiness> {
  const byKey = new Map(inputs.saved.map((s) => [s.questionKey, s]))
  const result = new Map<string, JobReadiness>()
  for (const job of jobs) {
    const stored = forms.get(postingKey(job))
    if (!stored) {
      result.set(job.id, { kind: supported.has(job.sourceId) ? 'not_fetched' : 'unsupported' })
      continue
    }
    // A job's own answer to a question comes before the general one.
    const own = inputs.jobSaved.get(job.id)
    const input = own ? { ...inputs.input, savedAnswers: [...own, ...inputs.input.savedAnswers] } : inputs.input
    const readiness = assessReadiness(stored.form, input)
    const suggestions = new Map<string, Suggestion>()
    const drafts = new Map<string, AnswerDraft>()
    for (const blocker of readiness.blockers) {
      const saved = byKey.get(inputs.matches[blocker.questionKey] ?? '')
      const suggestion = saved ? suggestionFor(blocker.question, saved, inputs.input) : null
      if (suggestion) suggestions.set(blocker.questionKey, suggestion)
      const draft = inputs.jobDrafts.get(jobDraftKey(job.id, blocker.questionKey)) ?? inputs.drafts.get(blocker.questionKey)
      if (draft) drafts.set(blocker.questionKey, draft)
    }
    result.set(job.id, { kind: 'assessed', readiness, fetchedAt: stored.fetchedAt, suggestions, drafts })
  }
  return result
}

/** Readiness of each job for the candidate: one read of their inputs and one of the stored forms. */
export async function readinessForJobs(db: Db, userId: string, jobs: readonly JobRef[]): Promise<Map<string, JobReadiness>> {
  const [inputs, forms] = await Promise.all([candidateInputs(db, userId), getApplicationForms(db, jobs)])
  const sourceIds = [...new Set(jobs.map((j) => j.sourceId))]
  const supported = new Set<string>()
  for (const sourceId of sourceIds) if (await sourcePublishesForms(db, sourceId)) supported.add(sourceId)
  return readinessFrom(jobs, forms, supported, inputs)
}

/**
 * The jobs the assistant prepares applications for: open, in "Can apply" by verdict or the
 * candidate's override, and not hidden or already applied to. A job whose title shares nothing
 * with the candidate's target roles (matching's role gap) is left out unless they saved it: its
 * questions would only cost answers and drafts nobody sends. A job not matched yet stays in.
 */
export async function jobsToApplyTo(db: Db, userId: string): Promise<Job[]> {
  const { assessments, states, matches } = await withTenant(db, userId, async (scope) => ({
    assessments: await listAssessments(scope), states: await listJobUserStates(scope), matches: await listMatches(scope),
  }))
  const state = new Map(states.map((s) => [s.jobId, s.state]))
  const roleGap = new Set(matches.filter((m) => m.dimensions.role.status === 'gap').map((m) => m.jobId))
  const ids = assessments
    .filter((a) => reviewGroup(a) === 'can_apply')
    .map((a) => a.jobId)
    .filter((id) => state.get(id) !== 'ignored' && state.get(id) !== 'applied')
    .filter((id) => !roleGap.has(id) || state.get(id) === 'saved')
  return (await getJobs(db, ids)).filter((job) => job.closedAt === null && job.canonicalJobId === null)
}

export type OpenQuestion = {
  readonly questionKey: string
  /** As the most common form words it. */
  readonly label: string
  readonly question: FormQuestion
  /** details and resume: answered on the details form; saved_answer: answered once, by question. */
  readonly answeredBy: 'details' | 'resume' | 'saved_answer'
  readonly jobIds: readonly string[]
  readonly suggestion: Suggestion | null
  /** The newest draft serving every job asking it, or the reason there is none; null when not drafted yet. */
  readonly draft: AnswerDraft | null
  /** Drafts written for one job (motivation), by job id: each answers that job only. */
  readonly draftsByJob: ReadonlyMap<string, AnswerDraft>
  /** Set when no draft is ever made for this question: only the candidate answers it. */
  readonly neverDrafted: NeverDrafted | null
}

/** Every question blocking at least one job, most widely blocking first: answering the top one unblocks the most. */
export function openQuestions(readiness: ReadonlyMap<string, JobReadiness>): OpenQuestion[] {
  type Entry = { question: FormQuestion; jobIds: string[]; suggestion: Suggestion | null; draft: AnswerDraft | null; draftsByJob: Map<string, AnswerDraft> }
  const byKey = new Map<string, Entry>()
  for (const [jobId, job] of readiness) {
    if (job.kind !== 'assessed') continue
    for (const blocker of job.readiness.blockers) {
      const entry: Entry = byKey.get(blocker.questionKey) ?? { question: blocker.question, jobIds: [], suggestion: null, draft: null, draftsByJob: new Map() }
      entry.jobIds.push(jobId)
      entry.suggestion ??= job.suggestions.get(blocker.questionKey) ?? null
      const draft = job.drafts.get(blocker.questionKey) ?? null
      if (draft?.jobId) entry.draftsByJob.set(draft.jobId, draft)
      else entry.draft ??= draft
      byKey.set(blocker.questionKey, entry)
    }
  }
  return [...byKey.entries()]
    .map(([key, entry]): OpenQuestion => ({
      questionKey: key, label: entry.question.label, question: entry.question,
      answeredBy: standardField(entry.question) ?? 'saved_answer', jobIds: entry.jobIds, suggestion: entry.suggestion,
      draft: entry.draft, draftsByJob: entry.draftsByJob, neverDrafted: neverDrafted(entry.question),
    }))
    .sort((a, b) => b.jobIds.length - a.jobIds.length || a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------------------
// "Same question, different wording" (decision 0013)

const MatchOutputSchema = z.object({ matches: z.array(z.object({ unanswered: z.string(), answered: z.string() })) })
export type MatchQuestions = (input: { readonly unanswered: readonly QuestionForMatching[]; readonly answered: readonly QuestionForMatching[] }) =>
  Promise<Result<CallModelSuccess<z.infer<typeof MatchOutputSchema>>, AiError>>

export const matchQuestionsWithModel: MatchQuestions = (input) => callModel({ task: matchQuestionsTask, schema: MatchOutputSchema, input })

/** Long lists are cut to keep one call small; the most widely blocking questions come first. */
const MAX_PER_SIDE = 200
const optionLabels = (question: FormQuestion) => question.fields.flatMap((f) => f.options.map((o) => o.label)).slice(0, 30)

export type MatchOutcome = { readonly kind: 'matched'; readonly suggestions: number } | { readonly kind: 'fresh' } | { readonly kind: 'nothing_to_match' }

/**
 * Pairs the candidate's unanswered questions (across their "Can apply" jobs) with questions
 * they already answered, and stores the pairs code accepted. Idempotent: the same questions
 * and answers are compared once. `rate_limited` and `upstream_failed` write nothing.
 */
export async function refreshQuestionMatches(db: Db, userId: string, match: MatchQuestions): Promise<Result<MatchOutcome>> {
  const inputs = await candidateInputs(db, userId)
  const jobs = await jobsToApplyTo(db, userId)
  const readiness = readinessFrom(jobs, await getApplicationForms(db, jobs), new Set(), inputs)
  const open = openQuestions(readiness).filter((q) => q.answeredBy === 'saved_answer').slice(0, MAX_PER_SIDE)
  const answered = inputs.saved.slice(0, MAX_PER_SIDE)
  if (open.length === 0 || answered.length === 0) return ok({ kind: 'nothing_to_match' })

  const inputsHash = createHash('sha256')
    .update(JSON.stringify({ open: open.map((q) => q.questionKey).sort(), answered: answered.map((a) => `${a.questionKey}=${JSON.stringify(a.answer)}`).sort() }))
    .digest('hex')
  const fresh = await withTenant(db, userId, (scope) => scope.db.select({ id: questionMatchRuns.id }).from(questionMatchRuns).where(and(
    eq(questionMatchRuns.userId, userId), eq(questionMatchRuns.inputsHash, inputsHash), eq(questionMatchRuns.taskVersion, matchQuestionsTask.version))))
  if (fresh.length > 0) return ok({ kind: 'fresh' })

  const unansweredIds = new Map(open.map((q, i) => [`u${i + 1}`, q]))
  const answeredIds = new Map(answered.map((a, i) => [`a${i + 1}`, a]))
  const result = await match({
    unanswered: [...unansweredIds].map(([id, q]) => ({ id, label: q.label, options: optionLabels(q.question) })),
    answered: [...answeredIds].map(([id, a]) => ({ id, label: a.label, options: a.answer.kind === 'choice' ? [...a.answer.labels] : [] })),
  })
  if (!result.ok && (result.error.code === 'rate_limited' || result.error.code === 'upstream_failed')) return err(domainError(result.error.code, result.error.message))
  const traces = result.ok ? result.value.traces : result.error.traces

  // A pair is kept only when the saved answer fits the new question as is: same options, compatible field.
  const matches: Record<string, string> = {}
  for (const pair of result.ok ? result.value.value.matches : []) {
    const question = unansweredIds.get(pair.unanswered)
    const saved = answeredIds.get(pair.answered)
    if (!question || !saved || matches[question.questionKey] !== undefined) continue
    if (suggestionFor(question.question, saved, inputs.input)) matches[question.questionKey] = saved.questionKey
  }
  await withTenant(db, userId, (scope) => scope.db.insert(questionMatchRuns).values({
    userId, inputsHash, taskVersion: matchQuestionsTask.version, matches, traces: [...traces],
    model: traces.at(-1)?.model ?? null, costMicroUsd: traces.reduce((sum, t) => sum + t.costMicroUsd, 0),
  }).onConflictDoNothing())
  return ok({ kind: 'matched', suggestions: Object.keys(matches).length })
}

/** The candidate accepts a suggestion: their saved answer, unchanged, becomes their answer to this question too. */
export async function acceptSuggestion(scope: TenantScope, input: { readonly label: string; readonly savedQuestionKey: string }): Promise<Result<SavedAnswer>> {
  const [saved] = await scope.db.select().from(savedAnswers)
    .where(and(eq(savedAnswers.userId, scope.userId), eq(savedAnswers.questionKey, input.savedQuestionKey), isNull(savedAnswers.jobId)))
  if (!saved) return err(domainError('not_found', 'That saved answer was not found.'))
  const answer = saved.answer.kind === 'choice' ? { kind: 'choice' as const, labels: [...saved.answer.labels] } : saved.answer
  // A drafted answer reused under new wording is still a drafted answer.
  return saveAnswer(scope, { label: input.label, answer }, saved.origin === 'draft' ? { origin: 'draft', draftId: saved.draftId } : { origin: 'owner' })
}

// ---------------------------------------------------------------------------
// Fetching forms

export type FormFetchRequest = { readonly payload: { readonly sourceId: string; readonly externalId: string }; readonly key: string }

/** The queue request for a job's form, or null when its source publishes no structured form. */
export async function formFetchRequest(db: Db, jobId: string): Promise<FormFetchRequest | null> {
  const job = await getJob(db, jobId)
  if (!job.ok || !(await sourcePublishesForms(db, job.value.sourceId))) return null
  const rawJobId = await getJobRawVersion(db, jobId)
  if (!rawJobId.ok) return null
  const payload = { sourceId: job.value.sourceId, externalId: job.value.externalId }
  return { payload, key: applicationFormFetchKey(payload, rawJobId.value) }
}

/** Producer for the jobs view: fetch a job's form now, after the candidate marks it as one they can take. */
export async function queueFormFetchNow(db: Db, redisUrl: string, jobId: string): Promise<Result<void>> {
  const request = await formFetchRequest(db, jobId)
  if (!request) return ok(undefined)
  const connection = connectRedis(redisUrl, 'producer')
  const queue = applicationFormFetchQueue.open({ connection })
  connection.on('error', () => logEvent('application_answers.enqueue_failed', { jobId }))
  try {
    await queue.enqueue(request.payload, request.key)
    return ok(undefined)
  } catch {
    return err(domainError('upstream_failed', 'Your choice is saved, but this job\'s application form could not be queued.'))
  } finally {
    await queue.close()
    connection.disconnect()
  }
}
