import Link from 'next/link'
import { standardField } from '@/modules/application-answers'
import type { FormQuestion } from '@/modules/job-sources'
import { AnswerForm } from './AnswerForm'

export function QuestionResponse({ question, back, answeredBy }: {
  readonly question: FormQuestion
  readonly back: string
  readonly answeredBy?: 'details' | 'resume' | 'saved_answer'
}) {
  const standard = answeredBy ?? standardField(question)
  if (standard === 'details') {
    return <p>Fill this in <Link href="/settings#details">Your details in settings</Link>.</p>
  }
  if (standard === 'resume') return <p>Upload a resume in the <Link href="/resumes">resume library</Link>.</p>
  return <AnswerForm question={question} back={back} />
}
