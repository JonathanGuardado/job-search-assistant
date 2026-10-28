'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getEnv } from '@/lib/env'
import {
  acceptDraft, acceptSuggestion, deleteSavedAnswer, queueDraftNow, queueQuestionMatch, saveAnswer, SaveAnswerSchema,
} from '@/modules/application-answers'
import { parseAnswer, parseJobId } from './answer-input'

const BackSchema = z.string().refine((value) => {
  if (!value.startsWith('/answers') && !value.startsWith('/jobs/')) return false
  try {
    const url = new URL(value, 'http://localhost')
    return url.origin === 'http://localhost'
      && (url.pathname.startsWith('/answers') || url.pathname.startsWith('/jobs/'))
  } catch {
    return false
  }
}).catch('/answers')

const SuggestionSchema = z.object({
  label: z.string().trim().min(1).max(2000),
  savedQuestionKey: z.string().min(1),
})

function errorUrl(back: string, message: string): string {
  const url = new URL(back, 'http://localhost')
  url.searchParams.set('error', message)
  return `${url.pathname}${url.search}${url.hash}`
}

async function refreshSuggestions(back: string): Promise<never> {
  await queueQuestionMatch(getEnv().REDIS_URL, DEV_USER.id)
  redirect(back)
}

export async function saveAnswerAction(form: FormData): Promise<void> {
  const back = BackSchema.parse(form.get('back'))
  const answer = parseAnswer(form)
  if (!answer.ok) redirect(errorUrl(back, answer.error.message))
  const jobId = parseJobId(form)
  if (!jobId.ok) redirect(errorUrl(back, jobId.error.message))
  const parsed = SaveAnswerSchema.safeParse({
    label: form.get('label'),
    answer: answer.value,
    ...(jobId.value === undefined ? {} : { jobId: jobId.value }),
  })
  if (!parsed.success) redirect(errorUrl(back, parsed.error.issues[0]?.message ?? 'Check your answer.'))
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => saveAnswer(scope, parsed.data))
  if (!result.ok) redirect(errorUrl(back, result.error.message))
  await refreshSuggestions(back)
}

export async function acceptDraftAction(form: FormData): Promise<void> {
  const back = BackSchema.parse(form.get('back'))
  const draftId = z.uuid().safeParse(form.get('draftId'))
  if (!draftId.success) redirect(errorUrl(back, 'Choose a draft to use.'))
  const answer = parseAnswer(form)
  if (!answer.ok) redirect(errorUrl(back, answer.error.message))
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => acceptDraft(scope, {
    draftId: draftId.data, answer: answer.value,
  }))
  if (!result.ok) redirect(errorUrl(back, result.error.message))
  await refreshSuggestions(back)
}

export async function acceptSuggestionAction(form: FormData): Promise<void> {
  const back = BackSchema.parse(form.get('back'))
  const parsed = SuggestionSchema.safeParse({ label: form.get('label'), savedQuestionKey: form.get('savedQuestionKey') })
  if (!parsed.success) redirect(errorUrl(back, parsed.error.issues[0]?.message ?? 'Check the suggested answer.'))
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => acceptSuggestion(scope, parsed.data))
  if (!result.ok) redirect(errorUrl(back, result.error.message))
  await refreshSuggestions(back)
}

export async function deleteAnswerAction(form: FormData): Promise<void> {
  const back = BackSchema.parse(form.get('back'))
  const parsed = z.string().min(1).safeParse(form.get('questionKey'))
  if (!parsed.success) redirect(errorUrl(back, 'Choose a saved answer to delete.'))
  const jobId = parseJobId(form)
  if (!jobId.ok) redirect(errorUrl(back, jobId.error.message))
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => deleteSavedAnswer(scope, parsed.data, jobId.value))
  if (!result.ok) redirect(errorUrl(back, result.error.message))
  await refreshSuggestions(back)
}

export async function draftNowAction(form: FormData): Promise<void> {
  const back = BackSchema.parse(form.get('back'))
  const questionKey = z.string().trim().min(1).safeParse(form.get('questionKey'))
  if (!questionKey.success) redirect(errorUrl(back, 'Choose a question to draft.'))
  const result = await queueDraftNow(getEnv().REDIS_URL, DEV_USER.id, questionKey.data)
  if (!result.ok) redirect(errorUrl(back, result.error.message))
  const url = new URL(back, 'http://localhost')
  url.searchParams.set('notice', 'Drafting started. Refresh in a minute to see the draft.')
  redirect(`${url.pathname}${url.search}${url.hash}`)
}
