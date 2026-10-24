import type { ApplicationStatus } from '@/modules/applications'
import styles from '../applications.module.css'

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', accepted: 'Accepted',
  rejected: 'Rejected', withdrawn: 'Withdrawn', no_response: 'No response',
}

export function ApplicationStatusBadge({ status }: { readonly status: ApplicationStatus }) {
  return <span className={styles.badge}>{STATUS_LABELS[status]}</span>
}
