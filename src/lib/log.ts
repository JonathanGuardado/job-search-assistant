/**
 * Structured log line on stdout. One JSON object per line so the output can be
 * shipped to any collector without parsing prose.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }))
}
