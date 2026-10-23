import { reviewGroup, type Assessment, type Verdict } from '@/modules/eligibility'
import { TAB_LABELS } from '../_lib/job-list'
import styles from '../jobs.module.css'

const VERDICT_LABELS: Record<Verdict, string> = { eligible: 'Eligible', needs_review: 'Needs review', not_eligible: 'Not eligible' }

export function EligibilityDetails({ assessment }: { readonly assessment: Assessment }) {
  const { reasons } = assessment
  return (
    <section className={styles.section} aria-labelledby="eligibility-heading">
      <h2 id="eligibility-heading">Eligibility · {TAB_LABELS[reviewGroup(assessment)]}</h2>
      <p>Engine verdict: {VERDICT_LABELS[assessment.verdict]}</p>
      {assessment.verdict === 'not_eligible' && 'reason' in reasons && <p>{reasons.reason}</p>}
      {assessment.verdict === 'needs_review' && 'openQuestions' in reasons && (
        <ul>{reasons.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul>
      )}
      {assessment.evidence.map((evidence, index) => <blockquote key={index}>“{evidence.quote}”</blockquote>)}
      {assessment.userOverride !== null && <div>
        <p>You marked this: {VERDICT_LABELS[assessment.userOverride]}</p>
        {assessment.overrideReason && <p>{assessment.overrideReason}</p>}
      </div>}
    </section>
  )
}
