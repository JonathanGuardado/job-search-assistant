import type { FillReport as Report } from '@/modules/automation'
import styles from '../../../jobs.module.css'

export function FillReport({ report }: { readonly report: Report | null }) {
  const fields = report?.fields ?? []
  const left = fields.filter((field) => field.result !== 'set')
  const filledCount = fields.filter((field) => field.result === 'set').length
  return (
    <div className={styles.fillGroup}>
      <h3>What the assistant could not do</h3>
      {report === null && <p>The browser did not report what it filled.</p>}
      {report !== null && left.length === 0 && <p>Nothing: every field was filled.</p>}
      {left.length > 0 && <ul className={styles.fillList}>
        {left.map((field, index) => (
          <li key={`${field.field}:${index}`}>
            <div className={styles.badges}>
              <strong>{field.label || field.field}</strong>
              {field.required && <span className={styles.badge}>Required</span>}
            </div>
            {field.detail !== null && <p>{field.detail}</p>}
          </li>
        ))}
      </ul>}
      {report !== null && <p>{filledCount} {filledCount === 1 ? 'field' : 'fields'} filled</p>}
    </div>
  )
}
