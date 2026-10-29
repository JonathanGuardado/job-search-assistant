import Link from 'next/link'
import type { Fill } from '@/modules/automation'
import { CancelFillForm, PrepareFillForm, SettleFillForm } from './FillForms'
import { FillReport } from './FillReport'
import { PacketReview } from './PacketReview'
import styles from '../../../jobs.module.css'

function WaitingFill({ fill }: { readonly fill: Fill }) {
  return <>
    <h2>Finish your application</h2>
    <p>The form is filled. Check it in the browser window, finish what is listed below, and press Submit there.</p>
    <FillReport report={fill.fillReport} />
    <SettleFillForm fill={fill} said="submitted" />
    <p className={styles.fillNote}>Use this if you submitted and this page has not noticed.</p>
  </>
}

function UncertainFill({ fill }: { readonly fill: Fill }) {
  return <>
    <h2>Was it submitted?</h2>
    <p>The assistant cannot tell whether this application was submitted.</p>
    {fill.error !== null && <p role="alert" className={styles.error}>{fill.error}</p>}
    {fill.submission !== null && <>
      <p>Your browser sent the application at {new Date(fill.submission.capturedAt).toLocaleString('en-US')}</p>
      <p>Greenhouse's answer: {fill.submission.response?.status ?? 'none seen'}</p>
    </>}
    <div className={styles.fillActions}>
      <SettleFillForm fill={fill} said="submitted" />
      <SettleFillForm fill={fill} said="not_submitted" />
    </div>
    <p className={styles.fillNote}>Until you say, the assistant will not open this job's form again.</p>
  </>
}

function SubmittedFill({ fill }: { readonly fill: Fill }) {
  return <>
    <h2>Submitted</h2>
    {fill.outcome === 'confirmed' && <p>Greenhouse confirmed it.</p>}
    {fill.outcome === 'user_reported' && <p>You said you submitted it.</p>}
    {fill.outcomeEvidence?.kind === 'confirmation_page' && <blockquote>{fill.outcomeEvidence.text}</blockquote>}
    {fill.applicationId !== null
      ? <Link href={`/applications/${fill.applicationId}`}>Open the application</Link>
      : <p>Recording the application… refresh in a moment.</p>}
    <FillReport report={fill.fillReport} />
  </>
}

const STOPPED_LINES = {
  failed: 'This fill failed.',
  abandoned: 'This fill was stopped before anything was sent.',
  stale: 'What you reviewed changed before the browser opened.',
}

function StoppedFill({ fill, line }: { readonly fill: Fill; readonly line: string }) {
  return <>
    <h2>Fill ended</h2>
    <p>{line}</p>
    {fill.error !== null && <p role="alert" className={styles.error}>{fill.error}</p>}
    {fill.outcome === 'rejected' && fill.outcomeEvidence?.kind === 'error' && <>
      <p>Greenhouse refused it</p>
      <blockquote>{fill.outcomeEvidence.text}</blockquote>
    </>}
    <PrepareFillForm jobId={fill.jobId} label="Review again" />
  </>
}

export function FillStatus({ fill }: { readonly fill: Fill }) {
  switch (fill.status) {
    case 'prepared':
      return <PacketReview fill={fill} />
    case 'queued':
    case 'launching':
    case 'filling':
      return <>
        <h2>Opening the form</h2>
        <p>Opening the form in a browser window…</p>
        <CancelFillForm fill={fill} />
      </>
    case 'waiting':
      return <WaitingFill fill={fill} />
    case 'uncertain':
      return <UncertainFill fill={fill} />
    case 'submitted':
      return <SubmittedFill fill={fill} />
    case 'failed':
    case 'abandoned':
    case 'stale':
      return <StoppedFill fill={fill} line={STOPPED_LINES[fill.status]} />
  }
}
