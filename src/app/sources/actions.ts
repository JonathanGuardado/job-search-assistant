'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { getEnv } from '@/lib/env'
import { addSource, enqueueSourcePoll, NewSourceSchema, setSourceEnabled } from '@/modules/job-sources'

const withError = (message: string) => `/sources?error=${encodeURIComponent(message)}`

export async function addSourceAction(form: FormData): Promise<void> {
  const parsed = NewSourceSchema.safeParse({ adapterKey: form.get('adapterKey'), name: form.get('name'), token: form.get('token') })
  if (!parsed.success) redirect(withError(parsed.error.issues[0]?.message ?? 'Check the source details.'))
  const result = await addSource(getDb(), parsed.data, fetch)
  if (!result.ok) redirect(withError(result.error.message))
  redirect('/sources')
}

export async function pollSourceAction(form: FormData): Promise<void> {
  const sourceId = z.uuid().safeParse(form.get('sourceId'))
  if (!sourceId.success) redirect(withError('Invalid source.'))
  const result = await enqueueSourcePoll(getEnv().REDIS_URL, { sourceId: sourceId.data, pollId: `m${Date.now()}`, cursor: null, startedAt: new Date() })
  if (!result.ok) redirect(withError(result.error.message))
  redirect('/sources')
}

const ToggleSourceSchema = z.object({ sourceId: z.uuid(), enabled: z.enum(['true', 'false']).transform((value) => value === 'true') })

export async function toggleSourceAction(form: FormData): Promise<void> {
  const parsed = ToggleSourceSchema.safeParse({ sourceId: form.get('sourceId'), enabled: form.get('enabled') })
  if (!parsed.success) redirect(withError('Invalid source controls.'))
  const result = await setSourceEnabled(getDb(), parsed.data.sourceId, parsed.data.enabled)
  if (!result.ok) redirect(withError(result.error.message))
  redirect('/sources')
}
