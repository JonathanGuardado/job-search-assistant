import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getApplicantDetails } from '@/modules/application-answers'
import { REGION_COUNTRIES } from '@/modules/eligibility'
import { getCandidateProfile } from '@/modules/profiles'
import { DetailsForm } from './_components/DetailsForm'
import { ProfileForm } from './_components/ProfileForm'
import styles from './settings.module.css'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({ searchParams }: {
  readonly searchParams: { readonly error?: string; readonly saved?: string }
}) {
  const { profile, details } = await withTenant(getDb(), DEV_USER.id, async (scope) => ({
    profile: await getCandidateProfile(scope), details: await getApplicantDetails(scope),
  }))
  return (
    <main className={styles.page}>
      <nav><Link href="/resumes">← Resume library</Link> · <Link href="/jobs">Jobs</Link> · <Link href="/applications">Applications</Link> · <Link href="/answers">Answers</Link></nav>
      <header>
        <p className={styles.eyebrow}>Job Seeker Assistant · Your preferences</p>
        <h1>Candidate settings</h1>
        <p>Tell us where and how you want to work. You control which requirements are firm.</p>
      </header>
      {searchParams.error && <p role="alert" className={styles.error}>{searchParams.error}</p>}
      {searchParams.saved === '1' && <p role="status" className={styles.success}>Your profile has been saved.</p>}
      {searchParams.saved === 'details' && <p role="status" className={styles.success}>Your details have been saved.</p>}
      <DetailsForm details={details} />
      {/* The location rule's own country table, read here: the eligibility module is server-only. */}
      <ProfileForm profile={profile} regionCountries={REGION_COUNTRIES} />
    </main>
  )
}
