'use server'

import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getEnv } from '@/lib/env'
import { enqueueReassessUser } from '@/modules/eligibility'
import { CandidateProfileFormSchema, profileFormInput, saveCandidateProfile } from '@/modules/profiles'

export async function saveProfileAction(form: FormData): Promise<void> {
  const parsed = CandidateProfileFormSchema.safeParse(profileFormInput(form))
  if (!parsed.success) redirect(`/settings?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Check your profile.')}`)
  const saved = await withTenant(getDb(), DEV_USER.id, (scope) => saveCandidateProfile(scope, parsed.data))
  if (!saved.ok) redirect(`/settings?error=${encodeURIComponent(saved.error.message)}`)
  const queued = await enqueueReassessUser(getEnv().REDIS_URL, DEV_USER.id)
  if (!queued.ok) redirect(`/settings?saved=1&error=${encodeURIComponent(queued.error.message)}`)
  redirect('/settings?saved=1')
}
