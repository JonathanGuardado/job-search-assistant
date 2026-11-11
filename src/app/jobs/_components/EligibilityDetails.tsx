import { reviewGroup, type Assessment, type Verdict } from '@/modules/eligibility'
import { TAB_LABELS } from '../_lib/job-list'
import styles from '../jobs.module.css'

const VERDICT_LABELS: Record<Verdict, string> = { eligible: 'Eligible', needs_review: 'Needs review', not_eligible: 'Not eligible' }

export function EligibilityDetails({ assessment }: { readonly assessment: Assessment }) {
  const { reasons } = assessment
  const group = reviewGroup(assessment)
  const tone = group === 'can_apply' ? styles.ok : group === 'not_eligible' ? styles.bad : styles.warn
  return (
    <section className={styles.section} aria-labelledby="eligibility-heading">
      <div className={styles.sectionHead}>
        <h2 id="eligibility-heading">Eligibility</h2>
        <span className={`${styles.pill} ${tone}`}>{TAB_LABELS[group]}</span>
      </div>
      <div className={`${styles.verdict} ${assessment.verdict === 'eligible' ? styles.ok : assessment.verdict === 'not_eligible' ? styles.bad : styles.warn}`}>
        {assessment.verdict === 'eligible' && <p>Nothing in the posting rules you out.</p>}
        {assessment.verdict === 'not_eligible' && 'reason' in reasons && <p>{reasons.reason}</p>}
        {assessment.verdict === 'needs_review' && 'openQuestions' in reasons && <>
          <p>The posting leaves this open:</p>
          <ul>{reasons.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul>
        </>}
      </div>
      {assessment.evidence.map((evidence, index) => <blockquote key={index}>“{evidence.quote}”</blockquote>)}
      <p className={styles.muted}>Engine verdict: {VERDICT_LABELS[assessment.verdict]}</p>
      {assessment.userOverride !== null && <div className={styles.override}>
        <p>You marked this: <strong>{VERDICT_LABELS[assessment.userOverride]}</strong></p>
        {assessment.overrideReason && <p className={styles.muted}>{assessment.overrideReason}</p>}
      </div>}
    </section>
  )
}
