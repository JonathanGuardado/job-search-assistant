import type { EvidenceSpan } from '@/modules/career-knowledge'
import styles from '../resumes.module.css'

type Segment = { readonly text: string; readonly marked: boolean }

/** Splits the text into plain and highlighted runs, merging overlapping spans. */
function segments(text: string, spans: readonly EvidenceSpan[]): Segment[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const span of sorted) {
    const last = merged.at(-1)
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ start: span.start, end: span.end })
  }

  const out: Segment[] = []
  let cursor = 0
  for (const { start, end } of merged) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), marked: false })
    out.push({ text: text.slice(start, end), marked: true })
    cursor = end
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), marked: false })
  return out
}

/** The resume's extracted text, with the selected entry's evidence highlighted. */
export function SourceText({ text, spans }: { readonly text: string; readonly spans: readonly EvidenceSpan[] }) {
  let firstMark = true
  return (
    <pre className={styles.sourceText}>
      {segments(text, spans).map((segment, index) => {
        if (!segment.marked) return segment.text
        const id = firstMark ? 'source-highlight' : undefined
        firstMark = false
        return (
          <mark key={index} id={id}>
            {segment.text}
          </mark>
        )
      })}
    </pre>
  )
}
