import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { ADAPTER_KEYS, listSources } from '@/modules/job-sources'
import styles from '../resumes/resumes.module.css'
import { addSourceAction, pollSourceAction, toggleSourceAction } from './actions'

export const dynamic = 'force-dynamic'

const date = (value: Date | null) => value?.toLocaleString('en-US', { timeZone: 'America/El_Salvador' }) ?? 'Not yet'

export default async function SourcesPage({ searchParams }: { readonly searchParams: { readonly error?: string } }) {
  const sources = await listSources(getDb())
  return (
    <main className={styles.page}>
      <Link href="/resumes" className={styles.backLink}>← Resume library</Link>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>Job Seeker Assistant · Discovery</p><h1>Job sources</h1><p className={styles.subtitle}>Connect company boards to capture their postings. Enabled sources are polled every six hours.</p></div>
        <span className={styles.count}>{sources.length} sources</span>
      </header>
      {searchParams.error && <p role="alert" className={styles.error}>{searchParams.error}</p>}
      <form action={addSourceAction} className={styles.upload}>
        <div><h2>Add a job board</h2><p className={styles.muted}>Use the company name and its Greenhouse board token or Lever site name.</p></div>
        <div className={styles.fields}>
          <label>Adapter<select name="adapterKey" required>{ADAPTER_KEYS.map((key) => <option key={key} value={key}>{key === 'greenhouse' ? 'Greenhouse' : 'Lever'}</option>)}</select></label>
          <label>Company name<input name="name" maxLength={100} required /></label>
          <label>Board token / site name<input name="token" pattern="[A-Za-z0-9_-]{1,100}" maxLength={100} required /></label>
          <div className={styles.actions}><button type="submit" className={styles.primaryButton}>Add source</button></div>
        </div>
      </form>
      <section className={styles.library} aria-label="Registered job boards">
        <div className={styles.sectionHeader}><h2>Registered sources</h2><p className={styles.muted}>Refresh to see new poll results and capture counts.</p></div>
        {sources.length === 0 ? <div className={styles.emptyState}><h2>No sources yet</h2><p className={styles.muted}>Add a board above to start collecting job postings.</p></div> : (
          <div className={styles.tableScroll}><table className={styles.table}>
            <thead><tr><th>Name</th><th>Adapter</th><th>Token</th><th>Enabled</th><th>Health</th><th>Last polled</th><th>Raw jobs</th><th>Actions</th></tr></thead>
            <tbody>{sources.map((source) => <tr key={source.id}>
              <td className={styles.filename}><strong>{source.name}</strong></td>
              <td>{source.adapterKey}</td><td>{source.config?.token ?? 'Invalid configuration'}</td><td>{source.enabled ? 'Yes' : 'No'}</td>
              <td><span className={`${styles.badge} ${source.healthStatus === 'ok' ? styles.badgeConfirmed : source.healthStatus === 'failing' ? styles.badgeError : styles.badgeDraft}`}>{source.healthStatus === 'ok' ? 'Healthy' : source.healthStatus === 'failing' ? 'Failing' : 'Not checked'}</span>
                {source.healthMessage && <p className={styles.statusDetail}>{source.healthMessage}</p>}
              </td>
              <td className={styles.date}>{date(source.lastPolledAt)}</td><td>{source.rawJobCount.toLocaleString('en-US')}</td>
              <td><div className={styles.rowActions}>
                <form action={pollSourceAction}><input type="hidden" name="sourceId" value={source.id} /><button type="submit" disabled={!source.enabled}>Poll now</button></form>
                <form action={toggleSourceAction}><input type="hidden" name="sourceId" value={source.id} /><input type="hidden" name="enabled" value={source.enabled ? 'false' : 'true'} /><button type="submit">{source.enabled ? 'Disable' : 'Enable'}</button></form>
              </div></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
    </main>
  )
}
