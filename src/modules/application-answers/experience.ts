import { z } from 'zod'
import { domainError, err, ok, type Result } from '@/lib/result'
import { callModel, type AiError, type CallModelSuccess, type ModelTrace } from '@/modules/ai'
import type { VerifiedCareerItem } from '@/modules/career-knowledge'
import type { FormQuestion } from '@/modules/job-sources'
import { checkGrounding, describeFailures, type DraftSentence, type GroundingSource } from './grounding.js'
import { writeExperienceTask, type ExperienceInput } from './prompts/write-experience.js'

/*
 * Experience drafts (decision 0014): a model writes from the candidate's confirmed career
 * items, citing them sentence by sentence; the grounding check decides whether anyone sees it.
 * A draft that fails is retried once with the failures named, then rejected.
 */

export const ExperienceOutputSchema = z.object({
  covered: z.boolean(),
  sentences: z.array(z.object({
    text: z.string().trim().min(1).max(800),
    sources: z.array(z.object({ item: z.string(), quote: z.string() })).max(6),
  })).max(8),
})
export type ExperienceOutput = z.infer<typeof ExperienceOutputSchema>
export type WriteExperience = (input: ExperienceInput) => Promise<Result<CallModelSuccess<ExperienceOutput>, AiError>>

export const writeExperienceWithModel: WriteExperience = (input) => callModel({ task: writeExperienceTask, schema: ExperienceOutputSchema, input })

export type ExperienceItem = Pick<VerifiedCareerItem,
  'id' | 'type' | 'organization' | 'title' | 'startedOn' | 'endedOn' | 'isCurrent' | 'summary' | 'achievements' | 'technologies'>

export type ExperienceDraft =
  | { readonly kind: 'drafted'; readonly text: string; readonly quotes: readonly string[]; readonly itemIds: readonly string[]; readonly traces: readonly ModelTrace[] }
  | { readonly kind: 'not_covered'; readonly traces: readonly ModelTrace[] }
  | { readonly kind: 'rejected'; readonly reason: string; readonly traces: readonly ModelTrace[] }

/** "March 2019" for "2019-03", "2019" for "2019": how the record states it, in words. */
function dateText(date: string): string {
  const [year, month] = date.split('-')
  if (!month) return year ?? date
  return `${new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${year}`
}

const headline = (item: ExperienceItem) => [item.title, item.organization].filter(Boolean).join(' at ')

/** What the model is shown for an item, and exactly what the grounding check reads. */
export function sourceText(item: ExperienceItem): string {
  const end = item.isCurrent ? 'present' : item.endedOn ? dateText(item.endedOn) : null
  const dates = item.startedOn ? [dateText(item.startedOn), end].filter(Boolean).join(' – ') : end
  return [
    `(${item.type}) ${headline(item)}${dates ? `, ${dates}` : ''}`,
    item.summary,
    ...item.achievements,
    item.technologies.length > 0 ? `Technologies: ${item.technologies.join(', ')}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

const sentencesOf = (output: ExperienceOutput): DraftSentence[] =>
  output.sentences.map((s) => ({ text: s.text, cites: s.sources.map((c) => ({ ref: c.item, quote: c.quote })) }))

/**
 * Writes and checks a draft for one question. Errors only when the provider is unavailable
 * (`rate_limited`, `upstream_failed`), so the run stops and is retried; every other outcome,
 * with the traces of every attempt, is a draft row.
 */
export async function draftExperience(write: WriteExperience, question: FormQuestion, items: readonly ExperienceItem[]): Promise<Result<ExperienceDraft>> {
  const byRef = new Map(items.map((item, i) => [`i${i + 1}`, item]))
  const sources: GroundingSource[] = [...byRef].map(([ref, item]) => ({ ref, text: sourceText(item) }))
  const traces: ModelTrace[] = []
  let problems: string[] = []

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await write({ question: { label: question.label, description: question.description }, items: sources, problems })
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
      // A passing check means every citation names an item that was given.
      const cited = sentences.flatMap((s) => s.cites).flatMap((c) => {
        const item = byRef.get(c.ref)
        return item ? [{ quote: c.quote.trim(), item }] : []
      })
      return ok({
        kind: 'drafted',
        text: sentences.map((s) => s.text.trim()).join(' '),
        quotes: cited.map((c) => `“${c.quote}” (${headline(c.item)})`),
        itemIds: [...new Set(cited.map((c) => c.item.id))],
        traces,
      })
    }
    problems = failures === null ? ['The draft has no sentences; write the answer, or set covered to false.'] : describeFailures(failures)
  }
  return ok({ kind: 'rejected', reason: `Both drafts said what your confirmed career items do not: ${problems.join(' ')}`, traces })
}
