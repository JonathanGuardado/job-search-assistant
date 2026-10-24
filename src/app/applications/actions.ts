'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { withTenant } from '@/lib/db/tenancy'
import { DEV_USER } from '@/lib/dev-user'
import {
  ApplicationEditSchema, NewApplicationSchema, StatusChangeSchema,
  changeStatus, createApplication, updateApplication,
} from '@/modules/applications'
import { salaryFromInput } from '@/modules/profiles'

const nullableText = z.string().trim().transform((value) => value || null)
const contactText = z.string().trim().transform((value) => value || undefined)
const DetailFieldsSchema = z.object({
  appliedOn: z.string(), resumeId: nullableText, salaryAmount: z.string(), salaryCurrency: z.string(),
  contactName: contactText, contactEmail: contactText, contactUrl: contactText, notes: nullableText,
})

function formError(back: string, message: string): never {
  redirect(`${back}?${new URLSearchParams({ error: message })}`)
}

function formId(form: FormData, key: 'jobId' | 'applicationId', fallback: string): string {
  const parsed = z.uuid().safeParse(form.get(key))
  if (!parsed.success) formError(fallback, parsed.error.issues[0]?.message ?? 'Choose a valid record.')
  return parsed.data
}

function detailInput(form: FormData, back: string) {
  const fields = DetailFieldsSchema.safeParse({
    appliedOn: form.get('appliedOn'), resumeId: form.get('resumeId'),
    salaryAmount: form.get('salaryAmount'), salaryCurrency: form.get('salaryCurrency'),
    contactName: form.get('contactName'), contactEmail: form.get('contactEmail'),
    contactUrl: form.get('contactUrl'), notes: form.get('notes'),
  })
  if (!fields.success) formError(back, fields.error.issues[0]?.message ?? 'Check your application details.')
  const input = fields.data
  const salary = salaryFromInput(input.salaryAmount, input.salaryCurrency)
  if (!salary.ok) formError(back, salary.error.message)
  const contact = {
    ...(input.contactName === undefined ? {} : { name: input.contactName }),
    ...(input.contactEmail === undefined ? {} : { email: input.contactEmail }),
    ...(input.contactUrl === undefined ? {} : { url: input.contactUrl }),
  }
  return {
    appliedOn: input.appliedOn, resumeId: input.resumeId, notes: input.notes,
    salaryAsked: salary.value === null ? null : { amountMinor: salary.value, currency: input.salaryCurrency },
    contact: Object.keys(contact).length === 0 ? null : contact,
  }
}

export async function logApplication(form: FormData): Promise<void> {
  const jobId = formId(form, 'jobId', '/jobs')
  const back = `/jobs/${jobId}`
  const sourceUrl = nullableText.safeParse(form.get('sourceUrl'))
  if (!sourceUrl.success) formError(back, sourceUrl.error.issues[0]?.message ?? 'Check the source URL.')
  const parsed = NewApplicationSchema.safeParse({
    ...detailInput(form, back), jobId, sourceUrl: sourceUrl.data,
  })
  if (!parsed.success) formError(back, parsed.error.issues[0]?.message ?? 'Check your application details.')
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => createApplication(scope, parsed.data))
  if (!result.ok) formError(back, result.error.message)
  redirect(`/applications/${result.value.id}`)
}

export async function changeApplicationStatus(form: FormData): Promise<void> {
  const applicationId = formId(form, 'applicationId', '/applications')
  const back = `/applications/${applicationId}`
  const parsed = StatusChangeSchema.safeParse({
    applicationId, to: form.get('to'), occurredOn: form.get('occurredOn'), note: form.get('note'),
  })
  if (!parsed.success) formError(back, parsed.error.issues[0]?.message ?? 'Check your stage change.')
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => changeStatus(scope, parsed.data))
  if (!result.ok) formError(back, result.error.message)
  redirect(back)
}

export async function editApplication(form: FormData): Promise<void> {
  const applicationId = formId(form, 'applicationId', '/applications')
  const back = `/applications/${applicationId}`
  const parsed = ApplicationEditSchema.safeParse({ ...detailInput(form, back), outcomeReason: form.get('outcomeReason') })
  if (!parsed.success) formError(back, parsed.error.issues[0]?.message ?? 'Check your application details.')
  const result = await withTenant(getDb(), DEV_USER.id, (scope) => updateApplication(scope, applicationId, parsed.data))
  if (!result.ok) formError(back, result.error.message)
  redirect(back)
}
