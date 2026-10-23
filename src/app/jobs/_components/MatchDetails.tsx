import type { CardSection, DimensionStatus, Match } from '@/modules/matching'
import styles from '../jobs.module.css'

const MARKERS: Record<DimensionStatus, string> = { meets: '✓', partial: '~', gap: '✗', unknown: '?', not_stated: '·' }

export function MatchDetails({ card }: {
  readonly card: { readonly match: Match; readonly sections: readonly CardSection[] } | null
}) {
  return (
    <section className={styles.section} aria-labelledby="match-heading">
      <h2 id="match-heading">How this job matches</h2>
      {card === null ? <p>Not matched yet.</p> : <>
        {card.match.concerns.length > 0 && <div>
          <h3>Before you apply</h3>
          <ul>{card.match.concerns.map((concern, index) => <li key={index}>{concern}</li>)}</ul>
        </div>}
        {card.sections.map((section) => <div key={section.dimension} className={styles.matchSection}>
          <h3><span aria-hidden="true">{MARKERS[section.status]} </span>{section.headline}</h3>
          <ul>{section.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
        </div>)}
      </>}
    </section>
  )
}
