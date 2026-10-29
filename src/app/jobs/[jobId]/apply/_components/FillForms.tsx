import type { Fill } from '@/modules/automation'
import { cancelFillAction, prepareFillAction, settleFillAction, startFillAction } from '../actions'
import styles from '../../../jobs.module.css'

function FillInputs({ fill }: { readonly fill: Fill }) {
  return <>
    <input type="hidden" name="fillId" value={fill.id} />
    <input type="hidden" name="jobId" value={fill.jobId} />
  </>
}

export function PrepareFillForm({ jobId, label = 'Review and fill' }: {
  readonly jobId: string
  readonly label?: string
}) {
  return (
    <form action={prepareFillAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <button type="submit">{label}</button>
    </form>
  )
}

export function StartFillForm({ fill }: { readonly fill: Fill }) {
  return (
    <form action={startFillAction} className={styles.fillStart}>
      <FillInputs fill={fill} />
      <input type="hidden" name="packetHash" value={fill.packetHash} />
      <button type="submit">Open the filled form</button>
      <p className={styles.fillNote}>A browser window opens on this computer, with the form filled. Nothing is sent until you press Submit in that window.</p>
    </form>
  )
}

export function CancelFillForm({ fill }: { readonly fill: Fill }) {
  return (
    <form action={cancelFillAction}>
      <FillInputs fill={fill} />
      <button type="submit">Cancel</button>
    </form>
  )
}

export function SettleFillForm({ fill, said }: {
  readonly fill: Fill
  readonly said: 'submitted' | 'not_submitted'
}) {
  return (
    <form action={settleFillAction}>
      <FillInputs fill={fill} />
      <input type="hidden" name="said" value={said} />
      <button type="submit">{said === 'submitted' ? 'I submitted it' : "I didn't submit it"}</button>
    </form>
  )
}
