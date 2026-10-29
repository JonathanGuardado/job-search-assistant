import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { expireFills, finishPending, getFill } from '@/modules/automation'
import { getJob } from '@/modules/jobs'
import { AppNavigation } from '@/app/_components/AppNavigation'
import { FillStatus } from '../_components/FillStatus'
import styles from '../../../jobs.module.css'

export const dynamic = 'force-dynamic'

const ParamsSchema = z.object({ jobId: z.uuid(), fillId: z.uuid() })

export default async function FillPage({ params, searchParams }: {
  readonly params: { readonly jobId: string; readonly fillId: string }
  readonly searchParams: Record<string, string | string[] | undefined>
}) {
  const parsed = ParamsSchema.safeParse(params)
  if (!parsed.success) notFound()
  const { jobId, fillId } = parsed.data
  const error = z.string().catch('').parse(searchParams.error)
  const notice = z.string().catch('').parse(searchParams.notice)
  const db = getDb()
  const fill = await withTenant(db, DEV_USER.id, async (scope) => {
    await expireFills(scope)
    await finishPending(scope, new Date().toISOString().slice(0, 10))
    return getFill(scope, fillId)
  })
  if (fill === null || fill.jobId !== jobId) notFound()
  const jobResult = await getJob(db, jobId)
  if (!jobResult.ok) notFound()
  const job = jobResult.value
  const refreshing = fill.status === 'queued' || fill.status === 'launching'
    || fill.status === 'filling' || fill.status === 'waiting'

  return (
    <main className={styles.page}>
      {/* Refreshes to the bare address, so a one-time notice is not shown again. */}
      {refreshing && <meta httpEquiv="refresh" content={`5;url=/jobs/${jobId}/apply/${fillId}`} />}
      <AppNavigation currentPath={`/jobs/${jobId}`} />
      <nav aria-label="Fill navigation"><Link href={`/jobs/${jobId}`}>← Back to job</Link></nav>
      <header>
        <p className={styles.eyebrow}>{job.companyName}</p>
        <h1>{job.title}</h1>
      </header>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <section className={styles.section}>
        <FillStatus fill={fill} />
      </section>
    </main>
  )
}
