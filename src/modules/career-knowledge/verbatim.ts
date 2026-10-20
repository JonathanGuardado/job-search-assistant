/**
 * Finds a model-supplied quote in the source text and returns where it is.
 *
 * The comparison ignores case, whitespace runs (PDF line wrapping), typographic
 * dashes and quotes, and compatibility forms such as the "ﬁ" ligature — the
 * differences a faithful copy can still have. Anything else is not verbatim.
 *
 * Offsets always point into the ORIGINAL text, so what is stored and
 * highlighted is the source's own characters, never the model's rendition.
 */

export type Span = {
  readonly start: number
  readonly end: number
  /** source.slice(start, end), for convenience. */
  readonly text: string
}

const DASHES = /[‐-―−]/g
const SINGLE_QUOTES = /[‘’‚‛]/g
const DOUBLE_QUOTES = /[“”„‟]/g
const WORD_CHAR = /[\p{L}\p{N}]/u

function normalizeChar(char: string): string {
  return char
    .normalize('NFKC')
    .toLowerCase()
    .replace(DASHES, '-')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
}

type Normalized = {
  readonly text: string
  /** For each normalized character, the original index it came from. */
  readonly origin: readonly number[]
}

function normalize(value: string): Normalized {
  let text = ''
  const origin: number[] = []
  let index = 0
  for (const char of value) {
    if (/\s/.test(char)) {
      if (text.length > 0 && !text.endsWith(' ')) {
        text += ' '
        origin.push(index)
      }
    } else {
      for (const piece of normalizeChar(char)) {
        text += piece
        origin.push(index)
      }
    }
    index += char.length
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    origin.pop()
  }
  return { text, origin }
}

export type Locate = (quote: string, options?: { readonly wholeWord?: boolean }) => Span | null

/** Normalizes the source once, so locating many quotes in one resume stays linear-ish. */
export function createLocator(source: string): Locate {
  const haystack = normalize(source)

  // End offset in the original text of the normalized character at `i`.
  const originalEnd = (i: number): number => {
    const start = haystack.origin[i] ?? source.length
    const codePoint = source.codePointAt(start)
    return start + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1)
  }

  const isWordChar = (i: number): boolean => {
    const char = haystack.text[i]
    return char !== undefined && WORD_CHAR.test(char)
  }

  return (quote, options = {}) => {
    const needle = normalize(quote).text
    if (needle.length === 0) return null

    for (
      let at = haystack.text.indexOf(needle);
      at !== -1;
      at = haystack.text.indexOf(needle, at + 1)
    ) {
      const last = at + needle.length - 1
      if (options.wholeWord && (isWordChar(at - 1) || isWordChar(last + 1))) continue
      const start = haystack.origin[at]
      if (start === undefined) return null
      const end = originalEnd(last)
      return { start, end, text: source.slice(start, end) }
    }
    return null
  }
}
