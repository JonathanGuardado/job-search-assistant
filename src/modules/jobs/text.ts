/** Lowercase, accents removed ("São" → "sao"), "&" spelled out. The base of every comparison key. */
export function foldText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('&', ' and ')
}

/** Letter and digit runs of folded text. */
export function wordsOf(text: string): string[] {
  return foldText(text).match(/[\p{L}\p{N}]+/gu) ?? []
}
