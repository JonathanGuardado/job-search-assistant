import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { listResumes, type ResumeSummary } from '@/modules/resumes'
import { retryParseAction, uploadResumeAction } from './actions'
import { AutoRefresh } from './_components/AutoRefresh'
import { DeleteResumeButton } from './_components/DeleteResumeButton'
import styles from './resumes.module.css'

export const dynamic = 'force-dynamic'

function parseStatus(resume: ResumeSummary): string {
  const parse = resume.latestParse
  if (parse === null) return 'Waiting to be read'
  if (parse.status === 'running') return 'Reading…'
  if (parse.status === 'succeeded') return 'Ready to review'
  return 'Needs attention'
}

export default async function ResumesPage({
  searchParams,
}: {
  readonly searchParams: { readonly error?: string }
}) {
  const resumes = await withTenant(getDb(), DEV_USER.id, (scope) => listResumes(scope))
  const isWaiting = resumes.some((r) => r.latestParse === null || r.latestParse.status === 'running')

  return (
    <main className={styles.page}>
      {isWaiting && <AutoRefresh seconds={3} />}
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Job Seeker Assistant · Career workspace</p>
          <h1>Resume library</h1>
          <p className={styles.subtitle}>Keep your experience together. Review each version and confirm what matters.</p>
        </div>
        <div className={styles.rowActions}>
          <span className={styles.count}>{resumes.length} {resumes.length === 1 ? 'version' : 'versions'}</span>
          <Link className={styles.secondaryButton} href="/settings">Candidate settings</Link>
        </div>
      </header>
      {searchParams.error && (
        <p role="alert" className={styles.error}>
          {searchParams.error}
        </p>
      )}

      <form action={uploadResumeAction} className={styles.upload}>
        <div>
          <h2>Add a resume</h2>
          <p className={styles.muted}>PDF or DOCX · Up to 5 MB · Each upload creates a new version</p>
        </div>
        <div className={styles.uploadControls}>
        <label className={styles.fileLabel}>
          Choose a resume
          <input
            type="file"
            name="file"
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
          />
        </label>
        <button type="submit" className={styles.primaryButton}>Upload resume</button>
        </div>
      </form>

      {resumes.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.badge}>Your experience starts here</span>
          <h2>No resumes yet</h2>
          <p className={styles.muted}>Upload your first resume to build a career record you can review and confirm.</p>
        </div>
      ) : (
        <section className={styles.library} aria-label="Resume versions">
        <div className={styles.sectionHeader}>
          <h2>Your versions</h2>
          <p className={styles.muted}>Newest first</p>
        </div>
        <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Version</th>
              <th>File</th>
              <th>Uploaded</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {resumes.map((resume) => (
              <tr key={resume.id}>
                <td><span className={styles.version}>v{resume.version}</span></td>
                <td className={styles.filename}>
                  <strong>{resume.filename}</strong>
                  <span className={styles.fileMeta}>
                    {resume.contentType === 'application/pdf' ? 'PDF' : 'DOCX'} · {Math.ceil(resume.byteSize / 1024)} KB
                  </span>
                </td>
                <td className={styles.date}>{resume.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/El_Salvador' })}</td>
                <td>
                  <span className={`${styles.badge} ${resume.latestParse?.status === 'succeeded' ? styles.badgeConfirmed : resume.latestParse?.status === 'failed' ? styles.badgeError : styles.badgeDraft}`}>
                    {parseStatus(resume)}
                  </span>
                  {resume.latestParse?.status === 'failed' && <p className={styles.statusDetail}>{resume.latestParse.errorMessage}</p>}
                </td>
                <td>
                  <div className={styles.rowActions}>
                  <Link className={styles.secondaryButton} href={`/resumes/${resume.id}/review`}>Review</Link>
                  <DeleteResumeButton
                    resumeId={resume.id}
                    filename={resume.filename}
                    isParsing={resume.latestParse?.status === 'running'}
                  />
                  {(resume.latestParse === null || resume.latestParse.status === 'failed') && (
                    <form action={retryParseAction}>
                      <input type="hidden" name="resumeId" value={resume.id} />
                      <button type="submit">{resume.latestParse === null ? 'Start reading' : 'Try again'}</button>
                    </form>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </section>
      )}
    </main>
  )
}
