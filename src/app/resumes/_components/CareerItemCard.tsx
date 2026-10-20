import Link from 'next/link'
import { CAREER_ITEM_TYPES, type CareerItem } from '@/modules/career-knowledge'
import { confirmItemAction, discardItemAction, saveItemAction } from '../actions'
import styles from '../resumes.module.css'

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

/** True when the stored value no longer matches what the resume said at parse time. */
function isCorrected(item: CareerItem): boolean {
  const { evidence } = item
  const differs = (value: string | null, span: { text: string } | undefined) =>
    span !== undefined && (value === null || collapse(value) !== collapse(span.text))
  return (
    differs(item.organization, evidence.organization) ||
    differs(item.title, evidence.title) ||
    differs(item.summary, evidence.summary) ||
    item.achievements.length !== evidence.achievements.length ||
    item.achievements.some((a, i) => collapse(a) !== collapse(evidence.achievements[i]?.text ?? ''))
  )
}

function heading(item: CareerItem): string {
  return [item.title, item.organization].filter(Boolean).join(' — ') || `Untitled ${item.type}`
}

export function CareerItemCard({
  item,
  resumeId,
  isFocused,
}: {
  readonly item: CareerItem
  readonly resumeId: string
  readonly isFocused: boolean
}) {
  return (
    <article id={`item-${item.id}`} className={`${styles.item} ${isFocused ? styles.itemFocused : ''}`}>
      <div className={styles.itemHeader}>
        <h3>{heading(item)}</h3>
        <span className={`${styles.badge} ${item.verifiedByUser ? styles.badgeConfirmed : styles.badgeDraft}`}>
          {item.verifiedByUser ? 'Confirmed' : 'Draft — not yet confirmed'}
          {isCorrected(item) ? ' · corrected by you' : ''}
        </span>
      </div>
      <Link href={`?item=${item.id}#source-highlight`} className={styles.evidenceLink}>
        Show where this came from in the resume
      </Link>

      <form>
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="resumeId" value={resumeId} />
        <div className={styles.fields}>
          <label>
            Type
            <select name="type" defaultValue={item.type}>
              {CAREER_ITEM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Organization
            <input name="organization" defaultValue={item.organization ?? ''} />
          </label>
          <label className={styles.wide}>
            Title
            <input name="title" defaultValue={item.title ?? ''} />
          </label>
          <label>
            Started (YYYY or YYYY-MM)
            <input name="startedOn" defaultValue={item.startedOn ?? ''} pattern="\d{4}(-(0[1-9]|1[0-2]))?" />
          </label>
          <label>
            Ended (YYYY or YYYY-MM)
            <input name="endedOn" defaultValue={item.endedOn ?? ''} pattern="\d{4}(-(0[1-9]|1[0-2]))?" />
          </label>
          <label className={`${styles.checkbox} ${styles.wide}`}>
            <input type="checkbox" name="isCurrent" defaultChecked={item.isCurrent} /> I still do this
          </label>
          <label className={styles.wide}>
            Summary
            <textarea name="summary" rows={2} defaultValue={item.summary ?? ''} />
          </label>
          <label className={styles.wide}>
            Achievements (one per line)
            <textarea name="achievements" rows={Math.max(3, item.achievements.length + 1)} defaultValue={item.achievements.join('\n')} />
          </label>
          <label className={styles.wide}>
            Technologies (comma-separated)
            <input name="technologies" defaultValue={item.technologies.join(', ')} />
          </label>
        </div>
        <div className={styles.actions}>
          <button className={styles.primaryButton} formAction={confirmItemAction}>{item.verifiedByUser ? 'Save changes' : 'Confirm entry'}</button>
          {!item.verifiedByUser && (
            <>
              <button formAction={saveItemAction}>Save draft</button>
              <button className={styles.dangerButton} formAction={discardItemAction}>Discard</button>
            </>
          )}
        </div>
      </form>
    </article>
  )
}
