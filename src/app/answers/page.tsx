import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getEnv } from '@/lib/env'
import {
  jobsToApplyTo, listSavedAnswers, openQuestions, queueAnswerDrafts, queueQuestionMatch, readinessForJobs,
} from '@/modules/application-answers'
import { AppNavigation } from '../_components/AppNavigation'
import { BlockingQuestion } from './_components/BlockingQuestion'
import { SavedAnswers } from './_components/SavedAnswers'
import styles from './answers.module.css'

export const dynamic = 'force-dynamic'

export default async function AnswersPage({ searchParams }: {
  readonly searchParams: Record<string, string | string[] | undefined>
}) {
  const error = z.string().catch('').parse(searchParams.error)
  const db = getDb()
  const jobs = await jobsToApplyTo(db, DEV_USER.id)
  const readiness = await readinessForJobs(db, DEV_USER.id, jobs)
  const questions = openQuestions(readiness)
  const answers = await withTenant(db, DEV_USER.id, listSavedAnswers)
  await queueQuestionMatch(getEnv().REDIS_URL, DEV_USER.id)
  await queueAnswerDrafts(getEnv().REDIS_URL, DEV_USER.id, 'opened')
  const results = [...readiness.values()]
  const ready = results.filter((job) => job.kind === 'assessed' && job.readiness.status === 'ready').length
  const blocked = results.filter((job) => job.kind === 'assessed' && job.readiness.status === 'blocked').length
  const unreadable = results.filter((job) => job.kind !== 'assessed').length

  return (
    <main className={styles.page}>
      <AppNavigation currentPath="/answers" />
      <header><p className={styles.eyebrow}>Job Seeker Assistant · Your applications</p><h1>Answers</h1></header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <section className={styles.section} aria-labelledby="questions-heading">
        <h2 id="questions-heading">Questions blocking your applications</h2>
        <p>{ready} of {results.length} jobs you can apply to are ready to send; {blocked} are blocked; {unreadable} have no form the assistant can read yet</p>
        {questions.length === 0 && <p className={styles.muted}>No blocking questions in the forms the assistant can read.</p>}
        {questions.map((question) => <BlockingQuestion key={question.questionKey} question={question} />)}
      </section>
      <section className={styles.section} aria-labelledby="saved-heading">
        <h2 id="saved-heading">Your saved answers</h2>
        <SavedAnswers answers={answers} readiness={readiness} />
      </section>
    </main>
  )
}
