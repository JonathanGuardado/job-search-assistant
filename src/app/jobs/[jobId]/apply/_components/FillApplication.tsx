import Link from 'next/link'
import type { Fill, FillStatus } from '@/modules/automation'
import { PrepareFillForm } from './FillForms'
import styles from '../../../jobs.module.css'

/** The button's words while a fill is under way; null once it ended and a new one can be prepared. */
const OPEN_FILL_LABELS: Readonly<Record<FillStatus, string | null>> = {
  prepared: 'Continue: reviewed, not started',
  queued: 'Opening the form…',
  launching: 'Opening the form…',
  filling: 'Opening the form…',
  waiting: 'Filled: finish it in the browser window',
  uncertain: 'Was it submitted? Tell the assistant',
  submitted: 'Submitted',
  abandoned: null,
  failed: null,
  stale: null,
}

/** Whether the job page has a fill to offer: one under way, or a form the assistant can fill. */
export function offersFill(fill: Fill | null, canPrepare: boolean): boolean {
  return canPrepare || (fill !== null && OPEN_FILL_LABELS[fill.status] !== null)
}

/** The job page's main action: go on with the fill under way, or review a new one. */
export function FillApplication({ jobId, fill, canPrepare }: {
  readonly jobId: string
  readonly fill: Fill | null
  /** The job's form was read, so a fill can be prepared. */
  readonly canPrepare: boolean
}) {
  const label = fill === null ? null : OPEN_FILL_LABELS[fill.status]
  if (fill !== null && label !== null) {
    return <Link href={`/jobs/${jobId}/apply/${fill.id}`} className={`${styles.button} ${styles.primary}`}>{label}</Link>
  }
  return canPrepare ? <PrepareFillForm jobId={jobId} label="Fill the application" primary /> : null
}
