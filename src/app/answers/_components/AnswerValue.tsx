import type { FilledValue, SavedAnswerValue } from '@/modules/application-answers'

export function AnswerValue({ value, truncate = false }: {
  readonly value: FilledValue | SavedAnswerValue
  readonly truncate?: boolean
}) {
  if (value.kind === 'file') return <>{value.label}</>
  if (value.kind === 'choice') return <>{'labels' in value ? value.labels.join(', ') : value.options.map((option) => option.label).join(', ')}</>
  return <>{truncate && value.text.length > 200 ? `${value.text.slice(0, 199)}…` : value.text}</>
}
