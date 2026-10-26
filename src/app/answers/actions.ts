'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import { getEnv } from '@/lib/env'
import {
  acceptSuggestion, ApplicantDetailsSchema, deleteSavedAnswer, queueQuestionMatch,
  saveAnswer, SaveAnswerSchema, saveApplicantDetails,
} from '@/modules/application-answers'

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

export async function saveDetailsAction(form: FormData): Promise<void> {
  const back = BackSchema.parse(form.get('back'))
  const input: Record<string, FormDataEntryValue | null> = {}
  for (const name of [
    'firstName', 'lastName', 'email', 'phone', 'linkedinUrl', 'githubUrl', 'websiteUrl',
  ]) {
    const value = form.get(name)
    input[name] = typeof value === 'string' ? value.trim() : value
  }
  for (const name of ['phone', 'linkedinUrl', 'githubUrl', 'websiteUrl']) {
    if (input[name] === '') input[name] = null
  }
  const parsed = ApplicantDetailsSchema.safeParse(input)
  if (!parsed.success) redirect(errorUrl(back, parsed.error.issues[0]?.message ?? 'Check your details.'))
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => saveApplicantDetails(scope, parsed.data))
  if (!result.ok) redirect(errorUrl(back, result.error.message))
  await refreshSuggestions(back)
}

export async function saveAnswerAction(form: FormData): Promise<void> {
  const back = BackSchema.parse(form.get('back'))
  const kind = form.get('kind')
  const text = form.get('text')
  const labels = form.getAll('option')
  if ((kind === 'choice' && labels.length === 0)
    || (kind === 'text' && (text === null || (typeof text === 'string' && text.trim() === '')))) {
    redirect(errorUrl(back, 'Choose or write an answer.'))
  }
  const parsed = SaveAnswerSchema.safeParse({
    label: form.get('label'),
    answer: kind === 'choice' ? { kind, labels } : { kind, text },
  })
  if (!parsed.success) redirect(errorUrl(back, parsed.error.issues[0]?.message ?? 'Check your answer.'))
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => saveAnswer(scope, parsed.data))
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
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => deleteSavedAnswer(scope, parsed.data))
  if (!result.ok) redirect(errorUrl(back, result.error.message))
  await refreshSuggestions(back)
}
