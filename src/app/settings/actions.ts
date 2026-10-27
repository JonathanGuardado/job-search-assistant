'use server'

import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getEnv } from '@/lib/env'
import { ApplicantDetailsSchema, queueAnswerDrafts, saveApplicantDetails } from '@/modules/application-answers'
import { enqueueReassessUser } from '@/modules/eligibility'
import { enqueueRematchUser } from '@/modules/matching'
import { CandidateProfileFormSchema, profileFormInput, saveCandidateProfile } from '@/modules/profiles'

export async function saveProfileAction(form: FormData): Promise<void> {
  const parsed = CandidateProfileFormSchema.safeParse(profileFormInput(form))
  if (!parsed.success) redirect(`/settings?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Check your profile.')}`)
  const saved = await withTenant(getDb(), DEV_USER.id, (scope) => saveCandidateProfile(scope, parsed.data))
  if (!saved.ok) redirect(`/settings?error=${encodeURIComponent(saved.error.message)}`)
  const queued = await enqueueReassessUser(getEnv().REDIS_URL, DEV_USER.id)
  if (!queued.ok) redirect(`/settings?saved=1&error=${encodeURIComponent(queued.error.message)}`)
  // Eligibility re-queues a match for each job it re-assesses, but a change only matching
  // reads (languages, preferred technologies) leaves eligibility's work deduplicated.
  const rematched = await enqueueRematchUser(getEnv().REDIS_URL, DEV_USER.id)
  if (!rematched.ok) redirect(`/settings?saved=1&error=${encodeURIComponent(rematched.error.message)}`)
  // Drafts are a convenience: the next visit to the answers page queues them again if this fails.
  await queueAnswerDrafts(getEnv().REDIS_URL, DEV_USER.id, 'profile_saved')
  redirect('/settings?saved=1')
}

const OPTIONAL_DETAILS = ['phone', 'linkedinUrl', 'githubUrl', 'websiteUrl']

/** Contact details feed application forms only: saving them re-checks nothing. */
export async function saveDetailsAction(form: FormData): Promise<void> {
  const input: Record<string, FormDataEntryValue | null> = {}
  for (const name of ['firstName', 'lastName', 'email', ...OPTIONAL_DETAILS]) {
    const value = form.get(name)
    input[name] = typeof value === 'string' ? value.trim() : value
    if (OPTIONAL_DETAILS.includes(name) && input[name] === '') input[name] = null
  }
  const parsed = ApplicantDetailsSchema.safeParse(input)
  if (!parsed.success) redirect(`/settings?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Check your details.')}#details`)
  const saved = await withTenant(getDb(), DEV_USER.id, (scope) => saveApplicantDetails(scope, parsed.data))
  if (!saved.ok) redirect(`/settings?error=${encodeURIComponent(saved.error.message)}#details`)
  redirect('/settings?saved=details#details')
}
