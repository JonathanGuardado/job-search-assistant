import type { PacketItem, PacketOrigin } from '@/modules/application-answers'
import { PREPARED_TTL_MS, type Fill } from '@/modules/automation'
import { AnswerValue } from '@/app/answers/_components/AnswerValue'
import { CancelFillForm, StartFillForm } from './FillForms'
import styles from '../../../jobs.module.css'

const SOURCE_LABELS: Readonly<Record<Extract<PacketItem, { kind: 'fill' }>['source'], string>> = {
  details: 'From your details',
  resume: 'Your resume',
  profile: 'From your profile',
  saved: 'Your saved answer',
}

const ORIGIN_LABELS: Readonly<Record<PacketOrigin, string>> = {
  owner: 'Written by you',
  profile_draft: 'From a profile draft you accepted',
  written_draft: 'From a written draft you accepted',
}

const UNRESOLVED_REASONS: Readonly<Record<Extract<PacketItem, { kind: 'unresolved' }>['reason'], string>> = {
  unanswered: 'Required, and not answered yet.',
  option_missing: "Your saved answer is not one of this form's options.",
  own_words: 'This employer asks for your own words; your saved answer came from a draft.',
  consent: 'A consent you give yourself on the form.',
}

function FilledItems({ items }: { readonly items: readonly PacketItem[] }) {
  return (
    <div className={styles.fillGroup}>
      <h3>Filled</h3>
      <ul className={styles.fillList}>
        {items.filter((item) => item.kind === 'fill').map((item, index) => (
          <li key={`${item.questionKey}:${index}`}>
            <strong>{item.label}</strong>
            <p className={styles.fillValue}><AnswerValue value={item.value} /></p>
            <p className={styles.fillSource}>{SOURCE_LABELS[item.source]}</p>
            {item.source === 'saved' && item.origin !== null && <span className={styles.badge}>{ORIGIN_LABELS[item.origin]}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function LeftItems({ items }: { readonly items: readonly PacketItem[] }) {
  const unresolved = items.filter((item) => item.kind === 'unresolved')
  const empty = items.filter((item) => item.kind === 'empty')
  return <>
    {unresolved.length > 0 && <div className={styles.fillGroup}>
      <h3>Left for you</h3>
      <ul className={styles.fillList}>
        {unresolved.map((item, index) => (
          <li key={`${item.questionKey}:${index}`}>
            <strong>{item.label}</strong>
            <p>{UNRESOLVED_REASONS[item.reason]}</p>
          </li>
        ))}
      </ul>
      <p>You'll finish these in the browser window before you press Submit.</p>
    </div>}
    {empty.length > 0 && <div className={styles.fillGroup}>
      <h3>Optional, left empty</h3>
      <ul className={styles.fillList}>
        {empty.map((item, index) => <li key={`${item.questionKey}:${index}`}>{item.label}</li>)}
      </ul>
    </div>}
  </>
}

export function PacketReview({ fill }: { readonly fill: Fill }) {
  const expiresAt = new Date(fill.createdAt.getTime() + PREPARED_TTL_MS)
  return <>
    <h2>What the browser will enter</h2>
    <FilledItems items={fill.packet.items} />
    <LeftItems items={fill.packet.items} />
    <p className={styles.muted}>This review can be started until {expiresAt.toLocaleString('en-US')}.</p>
    <div className={styles.fillActions}>
      <StartFillForm fill={fill} />
      <CancelFillForm fill={fill} />
    </div>
  </>
}
