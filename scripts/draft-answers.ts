import { closeDb, getDb } from '@/lib/db/client'
import { DEV_USER } from '@/lib/dev-user'
import { draftAnswers, jobsToApplyTo, openQuestions, readinessForJobs, readQuestionsWithModel, type OpenQuestion } from '@/modules/application-answers'

/*
 * `pnpm answers:draft`: one drafting run for the dev user, as the worker would do it, then
 * every question blocking their jobs with its draft, the reason it has none, or why it is
 * never drafted. Reading new question wordings calls the model; everything else is code.
 */

const describe = (question: OpenQuestion): string => {
  if (question.neverDrafted) return `only you · ${question.neverDrafted}`
  const draft = question.draft
  if (!draft) return 'not drafted (written answers come in the next part of 2.2, or only you can answer it)'
  if (draft.status !== 'drafted' || !draft.answer) return `no draft · ${draft.reason ?? draft.status}`
  const value = draft.answer.kind === 'text' ? draft.answer.text : draft.answer.labels.join(', ')
  return `DRAFT · ${value}   (${draft.basis.facts.join('; ')})`
}

try {
  const db = getDb()
  const started = Date.now()
  const outcome = await draftAnswers(db, DEV_USER.id, readQuestionsWithModel)
  if (!outcome.ok) throw new Error(`drafting stopped: ${outcome.error.message}`)
  console.log(`Run took ${((Date.now() - started) / 1000).toFixed(1)}s:`, outcome.value)

  const jobs = await jobsToApplyTo(db, DEV_USER.id)
  const open = openQuestions(await readinessForJobs(db, DEV_USER.id, jobs)).filter((q) => q.answeredBy === 'saved_answer')
  console.log(`\n${jobs.length} jobs the assistant works on; ${open.length} questions block them.\n`)
  for (const question of open) console.log(`${String(question.jobIds.length).padStart(3)} jobs · ${question.label.replace(/\s+/g, ' ').slice(0, 90)}\n          ${describe(question)}`)
} finally {
  await closeDb()
}
