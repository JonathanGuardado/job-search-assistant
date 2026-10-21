'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant, type TenantScope } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getEnv } from '@/lib/env'
import type { Result } from '@/lib/result'
import {
  CareerItemEditSchema,
  confirmCareerItem,
  discardDraft,
  prepareCareerItemsForResumeDeletion,
  enqueueResumeParse,
  resumeParseKey,
  saveCareerItem,
  type CareerItemEdit,
} from '@/modules/career-knowledge'
import {
  deleteResume,
  getLatestParse,
  getResume,
  isParseStalled,
  removeUnusedResumeFile,
  UploadResumeSchema,
  uploadResume,
} from '@/modules/resumes'

/*
 * Server actions are an edge: they parse form input with Zod, act as the dev
 * user until auth exists, and turn results into redirects. redirect() throws
 * by design, so it is never called inside a try block.
 */

const asDevUser = <T>(work: (scope: TenantScope) => Promise<T>) =>
  withTenant(getDb(), DEV_USER.id, work)

const withError = (path: string, message: string) =>
  `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`

async function enqueueParse(resumeId: string, retryNonce?: string): Promise<void> {
  const enqueued = await enqueueResumeParse(
    getEnv().REDIS_URL, { userId: DEV_USER.id, resumeId }, resumeParseKey(resumeId, retryNonce),
  )
  if (!enqueued.ok) redirect(withError('/resumes', enqueued.error.message))
}

export async function uploadResumeAction(formData: FormData): Promise<void> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) redirect(withError('/resumes', 'Choose a PDF or .docx file.'))

  const input = UploadResumeSchema.safeParse({
    filename: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })
  if (!input.success) redirect(withError('/resumes', 'That file name is not usable.'))

  const uploaded = await asDevUser((scope) =>
    uploadResume(scope, input.data, { storageRoot: getEnv().STORAGE_DIR }),
  )
  if (!uploaded.ok) redirect(withError('/resumes', uploaded.error.message))

  await enqueueParse(uploaded.value.id)
  redirect(`/resumes/${uploaded.value.id}/review`)
}

const ResumeIdSchema = z.uuid()

class ResumeDeletionError extends Error {}

export async function deleteResumeAction(formData: FormData): Promise<void> {
  const resumeId = ResumeIdSchema.safeParse(formData.get('resumeId'))
  if (!resumeId.success) redirect(withError('/resumes', 'Invalid resume.'))
  let storageKey: string
  try {
    storageKey = await asDevUser(async (scope) => {
      const deleted = await deleteResume(scope, resumeId.data, prepareCareerItemsForResumeDeletion)
      if (!deleted.ok) throw new ResumeDeletionError(deleted.error.message)
      return deleted.value
    })
  } catch (error) {
    if (!(error instanceof ResumeDeletionError)) throw error
    redirect(withError('/resumes', error.message))
  }
  const cleaned = await asDevUser((scope) =>
    removeUnusedResumeFile(scope, storageKey, getEnv().STORAGE_DIR),
  )
  if (!cleaned.ok) redirect(withError('/resumes', cleaned.error.message))
  redirect('/resumes')
}

export async function retryParseAction(formData: FormData): Promise<void> {
  const resumeId = ResumeIdSchema.safeParse(formData.get('resumeId'))
  if (!resumeId.success) redirect('/resumes')
  const current = await asDevUser(async (scope) => ({
    resume: await getResume(scope, resumeId.data), parse: await getLatestParse(scope, resumeId.data),
  }))
  if (!current.resume.ok) redirect(withError('/resumes', current.resume.error.message))
  // Pending uploads reuse their key; a failed or stalled parse needs a new queue job.
  // Retrying early is harmless: the worker leaves a run under a live lease alone.
  if (current.parse === null || current.parse.status === 'failed' || isParseStalled(current.parse)) {
    await enqueueParse(resumeId.data, current.parse === null ? undefined : String(Date.now()))
  }
  redirect(`/resumes/${resumeId.data}/review`)
}

// ---------------------------------------------------------------------------
// Review actions: one form per item, one action per button.

const ItemRefSchema = z.object({ itemId: z.uuid(), resumeId: z.uuid() })

const optionalText = (value: FormDataEntryValue | null): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const listFrom = (value: FormDataEntryValue | null, separator: string | RegExp): string[] =>
  (typeof value === 'string' ? value.split(separator) : []).map((s) => s.trim()).filter(Boolean)

function editFromForm(formData: FormData) {
  return CareerItemEditSchema.safeParse({
    type: formData.get('type'),
    organization: optionalText(formData.get('organization')),
    title: optionalText(formData.get('title')),
    startedOn: optionalText(formData.get('startedOn')),
    endedOn: optionalText(formData.get('endedOn')),
    isCurrent: formData.get('isCurrent') === 'on',
    summary: optionalText(formData.get('summary')),
    achievements: listFrom(formData.get('achievements'), /\r?\n/),
    technologies: listFrom(formData.get('technologies'), ','),
  })
}

async function applyEdit(
  formData: FormData,
  apply: (scope: TenantScope, itemId: string, edit: CareerItemEdit) => Promise<Result<unknown>>,
): Promise<void> {
  const ref = ItemRefSchema.safeParse({ itemId: formData.get('itemId'), resumeId: formData.get('resumeId') })
  if (!ref.success) redirect('/resumes')
  const back = `/resumes/${ref.data.resumeId}/review?item=${ref.data.itemId}`

  const edit = editFromForm(formData)
  if (!edit.success) redirect(withError(back, edit.error.issues[0]?.message ?? 'Check the highlighted entry.'))

  const result = await asDevUser((scope) => apply(scope, ref.data.itemId, edit.data))
  if (!result.ok) redirect(withError(back, result.error.message))
  redirect(back)
}

export async function saveItemAction(formData: FormData): Promise<void> {
  await applyEdit(formData, saveCareerItem)
}

export async function confirmItemAction(formData: FormData): Promise<void> {
  await applyEdit(formData, confirmCareerItem)
}

export async function discardItemAction(formData: FormData): Promise<void> {
  const ref = ItemRefSchema.safeParse({ itemId: formData.get('itemId'), resumeId: formData.get('resumeId') })
  if (!ref.success) redirect('/resumes')
  const back = `/resumes/${ref.data.resumeId}/review`
  const result = await asDevUser((scope) => discardDraft(scope, ref.data.itemId))
  if (!result.ok) redirect(withError(`${back}?item=${ref.data.itemId}`, result.error.message))
  redirect(back)
}
