import Link from 'next/link'
import type { Fill, FillStatus } from '@/modules/automation'
import { PrepareFillForm } from './FillForms'
import styles from '../../../jobs.module.css'

const STATUS_LINES: Readonly<Record<FillStatus, string | null>> = {
  prepared: 'Reviewed, not started.',
  queued: 'Opening the form…',
  launching: 'Opening the form…',
  filling: 'Opening the form…',
  waiting: 'Filled: finish it in the browser window.',
  uncertain: 'Was it submitted? Tell the assistant.',
  submitted: 'Submitted.',
  abandoned: null,
  failed: null,
  stale: null,
}

export function FillApplication({ jobId, fill }: {
  readonly jobId: string
  readonly fill: Fill | null
}) {
  const line = fill === null ? null : STATUS_LINES[fill.status]
  return (
    <section className={styles.section} aria-labelledby="fill-application-heading">
      <h2 id="fill-application-heading">Fill the application</h2>
      {fill !== null && line !== null ? <>
        <p>{line}</p>
        <Link href={`/jobs/${jobId}/apply/${fill.id}`}>Open</Link>
      </> : <>
        <PrepareFillForm jobId={jobId} />
        <p className={styles.fillNote}>The assistant fills the form in a browser window on this computer. You check it and press Submit yourself.</p>
      </>}
    </section>
  )
}
