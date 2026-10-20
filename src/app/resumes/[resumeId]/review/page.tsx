import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import {
  getParseReport,
  listCareerItems,
  type CareerItem,
  type EvidenceSpan,
  type RejectedValue,
} from '@/modules/career-knowledge'
import { getResume } from '@/modules/resumes'
import { retryParseAction } from '../../actions'
import { AutoRefresh } from '../../_components/AutoRefresh'
import { CareerItemCard } from '../../_components/CareerItemCard'
import { SourceText } from '../../_components/SourceText'
import styles from '../../resumes.module.css'

export const dynamic = 'force-dynamic'

const REASONS: Record<RejectedValue['reason'], string> = {
  not_in_source: 'not found in your resume',
  month_not_in_quote: 'the month was not written, so only the year was kept',
  date_not_in_quote: 'the date did not match what is written',
  not_marked_current: 'the resume does not say this is ongoing',
  conflicts_with_current: 'dropped because the entry is marked ongoing',
  empty_item: 'nothing about this entry could be found in your resume',
}

function spansOf(item: CareerItem | undefined): EvidenceSpan[] {
  if (!item) return []
  const { achievements, technologies, ...fields } = item.evidence
  return [...Object.values(fields).filter((s) => s !== undefined), ...achievements, ...technologies]
}

async function load(resumeId: string) {
  return withTenant(getDb(), DEV_USER.id, async (scope) => {
    const resume = await getResume(scope, resumeId)
    if (!resume.ok) return null
    const [report, items] = await Promise.all([getParseReport(scope, resumeId), listCareerItems(scope)])
    return { resume: resume.value, report, items }
  })
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  readonly params: { readonly resumeId: string }
  readonly searchParams: { readonly item?: string; readonly error?: string }
}) {
  const resumeId = z.uuid().safeParse(params.resumeId)
  if (!resumeId.success) notFound()
  const loaded = await load(resumeId.data)
  if (loaded === null) notFound()

  const { resume, report, items } = loaded
  const fromThisResume = items.filter((i) => i.sourceResumeId === resume.id)
  // D3: drafts from a new version often repeat what is already confirmed. Show both.
  const alreadyConfirmed = items.filter((i) => i.sourceResumeId !== resume.id && i.verifiedByUser)
  const focused = fromThisResume.find((i) => i.id === searchParams.item)
  const status = report.parse?.status
  const drafts = fromThisResume.filter((i) => !i.verifiedByUser).length

  return (
    <main className={styles.page}>
      {(status === undefined || status === 'running') && <AutoRefresh seconds={3} />}
      <Link href="/resumes" className={styles.backLink}>← Resume library</Link>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Check your experience</p>
          <h1>Review your resume</h1>
          <p className={styles.subtitle}>{resume.filename}</p>
        </div>
        <span className={styles.version}>Version {resume.version}</span>
      </header>
      {searchParams.error && (
        <p role="alert" className={styles.error}>
          {searchParams.error}
        </p>
      )}

      {status === undefined || status === 'running' ? (
        <p className={styles.notice}>Reading your resume… this page updates by itself.</p>
      ) : status === 'failed' ? (
        <div className={styles.error}>
          <strong>We couldn’t read this resume</strong>
          <p>{report.parse?.errorMessage}</p>
          <form action={retryParseAction}>
            <input type="hidden" name="resumeId" value={resume.id} />
            <button type="submit" className={styles.secondaryButton}>Try again</button>
          </form>
        </div>
      ) : (
        <div className={styles.notice}>
          <strong>{fromThisResume.length === 0 ? 'No entries found' : drafts === 0 ? 'All entries confirmed' : `${drafts} ${drafts === 1 ? 'entry needs' : 'entries need'} your review`}</strong>
          <p>{fromThisResume.length === 0
            ? 'Nothing could be matched to text in your resume. Try a .docx or a differently exported PDF.'
            : 'Check each entry below. Only confirmed entries can be used to write cover letters or answers.'}</p>
          {fromThisResume.length > 0 && (
            <div className={styles.progressRow}>
              <progress aria-label="Confirmed entries" value={fromThisResume.length - drafts} max={fromThisResume.length} />
              <span>{fromThisResume.length - drafts} / {fromThisResume.length} confirmed</span>
            </div>
          )}
        </div>
      )}

      {report.rejected.length > 0 && (
        <details className={styles.notice}>
          <summary>
            {report.rejected.length} extracted value{report.rejected.length === 1 ? ' was' : 's were'} left out
            because {report.rejected.length === 1 ? 'it' : 'they'} could not be found in your resume
          </summary>
          <ul>
            {report.rejected.map((r, i) => (
              <li key={i}>
                <strong>{r.field}</strong>: “{r.value}” — {REASONS[r.reason]}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={styles.review}>
        <section aria-label="Entries">
          {fromThisResume.length > 0 && <div className={styles.sectionHeader}><h2>Your experience</h2><span className={styles.muted}>{fromThisResume.length} entries</span></div>}
          {fromThisResume.map((item) => (
            <CareerItemCard key={item.id} item={item} resumeId={resume.id} isFocused={item.id === focused?.id} />
          ))}

          {alreadyConfirmed.length > 0 && (
            <div className={styles.previousItems}>
              <h2>Already confirmed from earlier versions</h2>
              <p className={styles.muted}>
                If an entry above repeats one of these, discard the draft instead of confirming it twice.
              </p>
              <ul>
                {alreadyConfirmed.map((item) => (
                  <li key={item.id}>
                    {[item.title, item.organization].filter(Boolean).join(' — ')}{' '}
                    <span className={styles.muted}>
                      {[item.startedOn, item.isCurrent ? 'present' : item.endedOn].filter(Boolean).join(' – ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-label="Resume text" className={styles.source}>
          <div className={styles.sourceHeader}>
          <p className={styles.eyebrow}>Source document</p>
          <h2>Original resume</h2>
          <p className={styles.muted}>
            {focused
              ? 'Highlighted: where the selected entry came from.'
              : 'Select “Show where this came from” on an entry to highlight its source.'}
          </p>
          </div>
          <SourceText text={resume.extractedText} spans={spansOf(focused)} />
        </section>
      </div>
    </main>
  )
}
