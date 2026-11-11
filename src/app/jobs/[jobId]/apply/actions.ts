'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getEnv } from '@/lib/env'
import {
  cancelFill, finishRecording, prepareFill, queueFill, settleFill, startFill,
} from '@/modules/automation'

function messageUrl(path: string, messages: { readonly error?: string; readonly notice?: string }): string {
  const search = new URLSearchParams(messages)
  return `${path}?${search}`
}

function parseJobId(form: FormData): string {
  const parsed = z.uuid().safeParse(form.get('jobId'))
  if (!parsed.success) redirect(messageUrl('/jobs', { error: 'Choose a job.' }))
  return parsed.data
}

function parseFill(form: FormData) {
  const jobId = parseJobId(form)
  const parsed = z.uuid().safeParse(form.get('fillId'))
  if (!parsed.success) redirect(messageUrl(`/jobs/${jobId}`, { error: 'Choose a fill.' }))
  const fillId = parsed.data
  return { jobId, fillId, back: `/jobs/${jobId}/apply/${fillId}` }
}

export async function prepareFillAction(form: FormData): Promise<void> {
  revalidatePath('/', 'layout')
  const jobId = parseJobId(form)
  const result = await prepareFill(getDb(), DEV_USER.id, jobId)
  if (!result.ok) redirect(messageUrl(`/jobs/${jobId}`, { error: result.error.message }))
  redirect(`/jobs/${jobId}/apply/${result.value.id}`)
}

export async function startFillAction(form: FormData): Promise<void> {
  revalidatePath('/', 'layout')
  const { fillId, back } = parseFill(form)
  const packetHash = z.string().min(1).safeParse(form.get('packetHash'))
  if (!packetHash.success) redirect(messageUrl(back, { error: 'Review the application again.' }))
  const db = getDb()
  const started = await withTenant(db, DEV_USER.id, (scope) => startFill(scope, fillId, packetHash.data))
  if (!started.ok) redirect(messageUrl(back, { error: started.error.message }))
  const queued = await queueFill(getEnv().REDIS_URL, DEV_USER.id, fillId)
  if (!queued.ok) {
    // The worker may have taken it anyway; then the cancel fails, and its error says what to do.
    const cancelled = await withTenant(db, DEV_USER.id, (scope) => cancelFill(scope, fillId))
    redirect(messageUrl(back, {
      error: cancelled.ok ? 'The worker could not be reached. Is `pnpm worker` running? Nothing was opened or sent.' : cancelled.error.message,
    }))
  }
  redirect(messageUrl(back, { notice: 'Opening the form in a browser window on this computer.' }))
}

export async function cancelFillAction(form: FormData): Promise<void> {
  revalidatePath('/', 'layout')
  const { fillId, back } = parseFill(form)
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => cancelFill(scope, fillId))
  redirect(messageUrl(back, result.ok ? { notice: 'Stopped. Nothing was sent.' } : { error: result.error.message }))
}

export async function settleFillAction(form: FormData): Promise<void> {
  revalidatePath('/', 'layout')
  const { fillId, back } = parseFill(form)
  const said = z.enum(['submitted', 'not_submitted']).safeParse(form.get('said'))
  if (!said.success) redirect(messageUrl(back, { error: 'Say whether you submitted the application.' }))
  const db = getDb()
  const settled = await withTenant(db, DEV_USER.id, (scope) => settleFill(scope, fillId, said.data))
  if (!settled.ok) redirect(messageUrl(back, { error: settled.error.message }))
  if (said.data === 'submitted') {
    const recorded = await withTenant(db, DEV_USER.id, (scope) =>
      finishRecording(scope, fillId, new Date().toISOString().slice(0, 10)))
    if (!recorded.ok) redirect(messageUrl(back, {
      notice: 'Recorded that you submitted it. The application will be recorded when you next open this page.',
      error: recorded.error.message,
    }))
  }
  redirect(messageUrl(back, { notice: 'Recorded.' }))
}
