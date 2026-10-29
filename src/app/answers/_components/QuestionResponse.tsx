import Link from 'next/link'
import { standardField } from '@/modules/application-answers'
import type { FormQuestion } from '@/modules/job-sources'
import { AnswerForm } from './AnswerForm'
import styles from '../answers.module.css'

export function QuestionResponse({ question, back, answeredBy, jobId, hasDraft = false }: {
  readonly question: FormQuestion
  readonly back: string
  readonly answeredBy?: 'details' | 'resume' | 'saved_answer'
  readonly jobId?: string
  readonly hasDraft?: boolean
}) {
  if (question.fields.some((field) => field.type === 'consent')) {
    return <p>You give this consent yourself on the application form; the assistant never ticks it.</p>
  }
  const standard = answeredBy ?? standardField(question)
  if (standard === 'details') {
    return <p>Fill this in <Link href="/settings#details">Your details in settings</Link>.</p>
  }
  if (standard === 'resume') return <p>Upload a resume in the <Link href="/resumes">resume library</Link>.</p>
  const form = <AnswerForm question={question} back={back} {...(jobId === undefined ? {} : { jobId })} />
  return hasDraft ? <details className={styles.disclosure}>
    <summary>Write your own answer instead</summary>
    {form}
  </details> : form
}
