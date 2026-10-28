import { z } from 'zod'
import { domainError, err, ok, type Result } from '@/lib/result'
import { SavedAnswerValueSchema } from '@/modules/application-answers'

const JobIdSchema = z.preprocess(
  (value) => value === null || value === '' ? undefined : value,
  z.uuid().optional(),
)

export function parseAnswer(form: FormData): Result<z.infer<typeof SavedAnswerValueSchema>> {
  const kind = form.get('kind')
  const text = form.get('text')
  const labels = form.getAll('option')
  if ((kind === 'choice' && labels.length === 0)
    || (kind === 'text' && (text === null || (typeof text === 'string' && text.trim() === '')))) {
    return err(domainError('invalid_input', 'Choose or write an answer.'))
  }
  const parsed = SavedAnswerValueSchema.safeParse(kind === 'choice' ? { kind, labels } : { kind, text })
  return parsed.success ? ok(parsed.data)
    : err(domainError('invalid_input', parsed.error.issues[0]?.message ?? 'Check your answer.'))
}

export function parseJobId(form: FormData): Result<string | undefined> {
  const parsed = JobIdSchema.safeParse(form.get('jobId'))
  return parsed.success ? ok(parsed.data) : err(domainError('invalid_input', 'Check your answer.'))
}
