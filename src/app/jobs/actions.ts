'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getEnv } from '@/lib/env'
import { setUserOverride } from '@/modules/eligibility'
import { setJobUserState, type JobUserStateValue } from '@/modules/jobs'
import { queueMatchNow } from '@/modules/matching'

const BackSchema = z.string().refine((value) => {
  if (!value.startsWith('/jobs')) return false
  const url = new URL(value, 'http://localhost')
  return url.origin === 'http://localhost' && (url.pathname === '/jobs' || url.pathname.startsWith('/jobs/'))
}).catch('/jobs')

const ActionSchema = z.object({
  jobId: z.uuid(), back: BackSchema,
  reason: z.string().trim().max(500).optional(),
})

function errorUrl(back: string, message: string): string {
  const url = new URL(back, 'http://localhost')
  url.searchParams.set('error', message)
  return `${url.pathname}${url.search}${url.hash}`
}

function parseAction(form: FormData) {
  const back = BackSchema.parse(form.get('back'))
  const parsed = ActionSchema.safeParse({
    jobId: form.get('jobId'), back, reason: form.get('reason') ?? undefined,
  })
  if (!parsed.success) redirect(errorUrl(back, parsed.error.issues[0]?.message ?? 'Check your job action.'))
  return parsed.data
}

async function changeState(form: FormData, state: Exclude<JobUserStateValue, 'applied'>): Promise<void> {
  const { jobId, back } = parseAction(form)
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => setJobUserState(scope, { jobId, state }))
  redirect(result.ok ? back : errorUrl(back, result.error.message))
}

export async function saveJob(form: FormData): Promise<void> {
  await changeState(form, 'saved')
}

export async function unsaveJob(form: FormData): Promise<void> {
  await changeState(form, 'new')
}

export async function hideJob(form: FormData): Promise<void> {
  await changeState(form, 'ignored')
}

export async function unhideJob(form: FormData): Promise<void> {
  await changeState(form, 'new')
}

export async function markEligible(form: FormData): Promise<void> {
  const { jobId, back, reason } = parseAction(form)
  const db = getDb()
  const result = await withTenant(db, DEV_USER.id, (scope) =>
    setUserOverride(scope, { jobId, verdict: 'eligible', reason: reason || null }))
  if (!result.ok) redirect(errorUrl(back, result.error.message))
  const queued = await queueMatchNow(db, getEnv().REDIS_URL, { userId: DEV_USER.id, jobId })
  redirect(queued.ok ? back : errorUrl(back, queued.error.message))
}

export async function undoVerdict(form: FormData): Promise<void> {
  const { jobId, back } = parseAction(form)
  const result = await withTenant(getDb(), DEV_USER.id, (scope) =>
    setUserOverride(scope, { jobId, verdict: null, reason: null }))
  redirect(result.ok ? back : errorUrl(back, result.error.message))
}
