import { foldText } from './text.js'

// Legal forms, compared after dots are dropped ("S.A." → "sa"). Only ever stripped from the end.
const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'ltda', 'corp', 'corporation', 'co', 'company',
  'plc', 'gmbh', 'ag', 'kg', 'sa', 'sas', 'sl', 'srl', 'spa', 'bv', 'nv', 'oy', 'ab', 'as', 'pte', 'pty',
])
// Mexican "S.A. de C.V.": "de" alone is an ordinary word, so it is stripped only as part of this form.
const SA_DE_CV = ['sa', 'de', 'cv']

/**
 * The company's comparison key: case, accents, punctuation and trailing legal forms
 * removed. Two different companies can share a key ("Clara" and "Clara Inc."); that
 * is acceptable because linking also requires the same title, location and text.
 */
export function normalizeCompany(name: string): string {
  const words = foldText(name).replace(/[.'’]/g, '').match(/[\p{L}\p{N}]+/gu) ?? []
  const kept = [...words]
  if (kept.length > SA_DE_CV.length && kept.slice(-SA_DE_CV.length).join(' ') === SA_DE_CV.join(' ')) kept.splice(-SA_DE_CV.length)
  while (kept.length > 1 && LEGAL_SUFFIXES.has(kept.at(-1) ?? '')) {
    kept.pop()
    // "Acme GmbH & Co. KG": a connector left dangling by a stripped form goes with it.
    if (kept.at(-1) === 'and') kept.pop()
  }
  return (kept.length > 0 ? kept : words).join(' ')
}
