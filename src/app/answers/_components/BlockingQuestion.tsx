import Link from 'next/link'
import type { OpenQuestion } from '@/modules/application-answers'
import { DraftOrMarker } from './DraftOrMarker'
import { QuestionResponse } from './QuestionResponse'
import { SuggestedAnswer } from './SuggestedAnswer'
import styles from '../answers.module.css'

function JobDrafts({ question, jobNames }: {
  readonly question: OpenQuestion
  readonly jobNames: ReadonlyMap<string, string>
}) {
  const firstUndraftedJobId = question.jobIds.find((id) => !question.draftsByJob.has(id))
  return <>
    <p>This question is answered for each job separately.</p>
    {question.jobIds.map((jobId) => {
      const draft = question.draftsByJob.get(jobId) ?? null
      return <div key={jobId} className={styles.jobDraft}>
        <h4><Link href={`/jobs/${jobId}`}>{jobNames.get(jobId) ?? 'View job'}</Link></h4>
        {draft !== null || question.neverDrafted !== null || jobId === firstUndraftedJobId
          ? <DraftOrMarker question={question.question} questionKey={question.questionKey} draft={draft}
            neverDrafted={question.neverDrafted} back="/answers" />
          : <p className={styles.muted}>Not drafted yet.</p>}
      </div>
    })}
  </>
}

export function BlockingQuestion({ question, jobNames }: {
  readonly question: OpenQuestion
  readonly jobNames: ReadonlyMap<string, string>
}) {
  return (
    <article className={styles.question}>
      <h3>{question.label}</h3>
      {question.question.description !== null && <p className={styles.description}>{question.question.description}</p>}
      <div className={styles.badges}>
        <span className={styles.badge}>Required</span>
        <span className={styles.badge}>Blocks {question.jobIds.length} {question.jobIds.length === 1 ? 'job' : 'jobs'}</span>
      </div>
      {question.answeredBy !== 'saved_answer'
        ? <QuestionResponse question={question.question} answeredBy={question.answeredBy} back="/answers" />
        : question.perJob || question.draftsByJob.size > 0 ? <JobDrafts question={question} jobNames={jobNames} /> : <>
          <DraftOrMarker question={question.question} questionKey={question.questionKey} draft={question.draft}
            neverDrafted={question.neverDrafted} back="/answers" />
          {question.suggestion !== null && <SuggestedAnswer label={question.label} suggestion={question.suggestion} back="/answers" />}
          <QuestionResponse question={question.question} answeredBy="saved_answer" back="/answers"
            hasDraft={question.neverDrafted === null && question.draft?.status === 'drafted'} />
        </>}
    </article>
  )
}
