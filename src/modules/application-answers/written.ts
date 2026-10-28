import { z } from 'zod'
import { domainError, err, ok, type Result } from '@/lib/result'
import { callModel, type AiError, type CallModelSuccess, type ModelTrace } from '@/modules/ai'
import type { VerifiedCareerItem } from '@/modules/career-knowledge'
import type { FormQuestion } from '@/modules/job-sources'
import { checkGrounding, describeFailures, type DraftSentence, type GroundingSource } from './grounding.js'
import { writeExperienceTask, type WrittenInput } from './prompts/write-experience.js'
import { writeMotivationTask } from './prompts/write-motivation.js'

/*
 * Written drafts (decision 0014): experience answers from the candidate's confirmed career
 * items, and motivation answers from those items plus the job's posting. A model writes,
 * citing its sources sentence by sentence; the grounding check decides whether anyone sees it.
 * A draft that fails is retried once with the failures named, then rejected.
 */

export const WrittenOutputSchema = z.object({
  covered: z.boolean(),
  sentences: z.array(z.object({
    text: z.string().trim().min(1).max(800),
    sources: z.array(z.object({ item: z.string(), quote: z.string() })).max(6),
  })).max(8),
})
export type WrittenOutput = z.infer<typeof WrittenOutputSchema>
export type WriteAnswer = (input: WrittenInput) => Promise<Result<CallModelSuccess<WrittenOutput>, AiError>>

export const writeExperienceWithModel: WriteAnswer = (input) => callModel({ task: writeExperienceTask, schema: WrittenOutputSchema, input })
export const writeMotivationWithModel: WriteAnswer = (input) => callModel({ task: writeMotivationTask, schema: WrittenOutputSchema, input })

export type WrittenItem = Pick<VerifiedCareerItem,
  'id' | 'type' | 'organization' | 'title' | 'startedOn' | 'endedOn' | 'isCurrent' | 'summary' | 'achievements' | 'technologies'>

export type WrittenDraft =
  | { readonly kind: 'drafted'; readonly text: string; readonly quotes: readonly string[]; readonly itemIds: readonly string[]; readonly traces: readonly ModelTrace[] }
  | { readonly kind: 'not_covered'; readonly traces: readonly ModelTrace[] }
  | { readonly kind: 'rejected'; readonly reason: string; readonly traces: readonly ModelTrace[] }

/** "March 2019" for "2019-03", "2019" for "2019": how the record states it, in words. */
function dateText(date: string): string {
  const [year, month] = date.split('-')
  if (!month) return year ?? date
  return `${new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${year}`
}

const headline = (item: WrittenItem) => [item.title, item.organization].filter(Boolean).join(' at ')

/** What the model is shown for an item, and exactly what the grounding check reads. */
export function sourceText(item: WrittenItem): string {
  const end = item.isCurrent ? 'present' : item.endedOn ? dateText(item.endedOn) : null
  const dates = item.startedOn ? [dateText(item.startedOn), end].filter(Boolean).join(' – ') : end
  return [
    `(${item.type}) ${headline(item)}${dates ? `, ${dates}` : ''}`,
    item.summary,
    ...item.achievements,
    item.technologies.length > 0 ? `Technologies: ${item.technologies.join(', ')}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

const sentencesOf = (output: WrittenOutput): DraftSentence[] =>
  output.sentences.map((s) => ({ text: s.text, cites: s.sources.map((c) => ({ ref: c.item, quote: c.quote })) }))

const POSTING_REF = 'posting'

/**
 * Writes and checks a draft for one question, from the confirmed items and, for a motivation
 * answer, the job's posting. Errors only when the provider is unavailable (`rate_limited`,
 * `upstream_failed`), so the run stops and is retried; every other outcome, with the traces of
 * every attempt, is a draft row.
 */
export async function draftWritten(write: WriteAnswer, question: FormQuestion, items: readonly WrittenItem[], postingText: string | null = null): Promise<Result<WrittenDraft>> {
  const byRef = new Map(items.map((item, i) => [`i${i + 1}`, item]))
  const posting = postingText === null ? null : { ref: POSTING_REF, text: postingText }
  const itemSources: GroundingSource[] = [...byRef].map(([ref, item]) => ({ ref, text: sourceText(item) }))
  const sources = posting ? [...itemSources, posting] : itemSources
  const traces: ModelTrace[] = []
  let problems: string[] = []

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await write({ question: { label: question.label, description: question.description }, items: itemSources, posting, problems })
    traces.push(...(result.ok ? result.value.traces : result.error.traces))
    if (!result.ok) {
      if (result.error.code === 'rate_limited' || result.error.code === 'upstream_failed') return err(domainError(result.error.code, result.error.message))
      return ok({ kind: 'rejected', reason: 'The model did not return a usable draft.', traces })
    }
    const output = result.value.value
    if (!output.covered) return ok({ kind: 'not_covered', traces })
    const sentences = sentencesOf(output)
    const failures = sentences.length === 0 ? null : checkGrounding({ question: `${question.label} ${question.description ?? ''}`, sources, sentences })
    if (failures?.length === 0) {
      // A passing check means every citation names a source that was given.
      const cited = sentences.flatMap((s) => s.cites).map((c) => ({ quote: c.quote.trim(), item: byRef.get(c.ref) ?? null }))
      return ok({
        kind: 'drafted',
        text: sentences.map((s) => s.text.trim()).join(' '),
        quotes: cited.map((c) => `“${c.quote}” (${c.item ? headline(c.item) : 'the job posting'})`),
        itemIds: [...new Set(cited.flatMap((c) => (c.item ? [c.item.id] : [])))],
        traces,
      })
    }
    problems = failures === null ? ['The draft has no sentences; write the answer, or set covered to false.'] : describeFailures(failures)
  }
  return ok({ kind: 'rejected', reason: `Both drafts said what their sources do not: ${problems.join(' ')}`, traces })
}
