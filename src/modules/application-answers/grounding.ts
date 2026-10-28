/*
 * The grounding check (CLAUDE.md rule 1, decision 0014), deterministic, on every written
 * draft. Every sentence must cite at least one career item the model was given, carry a quote
 * found verbatim in what it cites, and contain no number, name, technology-shaped token or
 * term the question asks about unless the items it cites contain it, and no placeholder ("[N]"). What it cannot catch is
 * an invented event told entirely in common words; the per-sentence quote and the owner's
 * review cover that.
 */

/** One confirmed career item, as the model saw it: `text` is exactly what it was shown. */
export type GroundingSource = { readonly ref: string; readonly text: string }
export type DraftSentence = { readonly text: string; readonly cites: readonly { readonly ref: string; readonly quote: string }[] }

export type GroundingFailure =
  | { readonly sentence: number; readonly problem: 'no_citation' }
  | { readonly sentence: number; readonly problem: 'unknown_source'; readonly ref: string }
  | { readonly sentence: number; readonly problem: 'quote_not_found'; readonly ref: string; readonly quote: string }
  | { readonly sentence: number; readonly problem: 'unsupported_term'; readonly term: string }
  /** "[N]", "[X%]": an unfinished career item's blank, grounded but not sendable. */
  | { readonly sentence: number; readonly problem: 'placeholder'; readonly text: string }

/** Shorter quotes ("the", "API") anchor nothing. */
const MIN_QUOTE_CHARS = 8

/** Words a sentence may start with, capitalized, without being a name. */
const STARTERS = new Set(`
  a about across after again all along alongside also although among an and another any as at because before being beyond
  both but by currently day during each earlier every finally first for from further having here however i if in including
  it its later leading lately like many more most mostly much my next not now of on once one only our outside over overall
  previously primarily prior rather recently since so some still that the then there these this those though through
  throughout to today together under until using when where which while with within working yes`.split(/\s+/).filter(Boolean))

/** Question words that say what kind of answer is wanted, not what the candidate did. */
const GENERIC = new Set(`
  ability able about achievement any application approach area best brief briefly build building built career case code
  coding company comfortable competence contribute contribution current deep describe detail develop developer developing
  development during engineer engineering environment example experience experienced explain familiar familiarity focus
  focusing gain gained give hand hands-on have highlight highlighting include including involved involvement job kind knowledge
  large level life like list major make many most much notable organization organisation other outline over own past
  platform please position practical previous prior product professional professionally program programming project
  proud provide recent recently related relevant responsibility responsible role service share significant skill software
  solution some specific specifically strong such system team technical technology tell that them there these they this
  those time tool under used using very what when where which while will with within work worked working would year your
  apply applying excite excited exciting fit interest interested join joining motivate motivated motivation
  opportunity right want`
  .split(/\s+/).filter(Boolean).map(stem))

const normalize = (text: string) => text.normalize('NFKC').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase()

function stem(word: string): string {
  const lower = word.toLowerCase().replace(/['’]s$/, '')
  return lower.length > 4 && lower.endsWith('s') && !lower.endsWith('ss') ? lower.slice(0, -1) : lower
}

const WORD = /\p{L}[\p{L}\p{N}'’-]*/gu
const words = (text: string) => text.match(WORD) ?? []

/** `term` appears in `text` as a whole token: no letter or digit right before or after it. */
function containsTerm(text: string, term: string): boolean {
  const haystack = normalize(text)
  const needle = normalize(term)
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1] ?? ' '
    const after = haystack[at + needle.length] ?? ' '
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true
  }
  return false
}

const PLACEHOLDER = /\[[^\]\n]{1,24}\]/g

const TECH_SHAPED = /[\p{L}\p{N}][+#]|[\p{L}\p{N}]\.\p{L}|\p{L}\/\p{L}/u
const NOT_TECH = new Set(['and/or', 'e.g', 'i.e', 'etc'])

/** Numbers, technology-shaped tokens and capitalized words in a sentence, as written. */
function shapedTerms(sentence: string): string[] {
  const found: string[] = []
  sentence.split(/\s+/).forEach((raw, index) => {
    const token = raw.replace(/^[("'“‘[]+/, '').replace(/[)"'”’\],.;:!?]+$/, '').replace(/['’]s$/, '')
    if (!token) return
    if (/\p{N}/u.test(token)) found.push(token)
    else if (TECH_SHAPED.test(token) && !NOT_TECH.has(token.toLowerCase())) found.push(token)
    else if (/\p{Lu}/u.test(token)) {
      if (token === 'I' || /^I['’](m|ve|d|ll)$/.test(token)) return
      if (index === 0 && STARTERS.has(token.toLowerCase())) return
      found.push(token)
    }
  })
  return found
}

/** The question's own subject words ("search", "indexing", "Kubernetes"), by stem. */
function questionTerms(question: string): Set<string> {
  return new Set(words(question).map(stem).filter((s) => s.length >= 4 && !GENERIC.has(s)))
}

export function checkGrounding(input: {
  readonly question: string
  readonly sources: readonly GroundingSource[]
  readonly sentences: readonly DraftSentence[]
}): GroundingFailure[] {
  const byRef = new Map(input.sources.map((s) => [s.ref, s]))
  const asked = questionTerms(input.question)
  const failures: GroundingFailure[] = []

  input.sentences.forEach((sentence, index) => {
    if (sentence.cites.length === 0) {
      failures.push({ sentence: index, problem: 'no_citation' })
      return
    }
    for (const [text] of sentence.text.matchAll(PLACEHOLDER)) failures.push({ sentence: index, problem: 'placeholder', text })
    const cited: GroundingSource[] = []
    for (const cite of sentence.cites) {
      const source = byRef.get(cite.ref)
      if (!source) {
        failures.push({ sentence: index, problem: 'unknown_source', ref: cite.ref })
        continue
      }
      cited.push(source)
      const quote = normalize(cite.quote)
      if (quote.length < MIN_QUOTE_CHARS || !normalize(source.text).includes(quote)) {
        failures.push({ sentence: index, problem: 'quote_not_found', ref: cite.ref, quote: cite.quote })
      }
    }
    if (cited.length === 0) return

    const sourceText = cited.map((s) => s.text).join('\n')
    const sourceStems = new Set(words(sourceText).map(stem))
    const flagged = new Set<string>()
    const flag = (term: string) => {
      if (flagged.has(term.toLowerCase())) return
      flagged.add(term.toLowerCase())
      failures.push({ sentence: index, problem: 'unsupported_term', term })
    }
    for (const term of shapedTerms(sentence.text)) if (!containsTerm(sourceText, term)) flag(term)
    for (const word of words(sentence.text)) {
      const s = stem(word)
      if (asked.has(s) && !sourceStems.has(s)) flag(word)
    }
  })
  return failures
}

/** Each failure in words a retry prompt, or the owner reading why there is no draft, can act on. */
export function describeFailures(failures: readonly GroundingFailure[]): string[] {
  return failures.map((failure) => {
    const n = failure.sentence + 1
    switch (failure.problem) {
      case 'no_citation': return `Sentence ${n} cites no career item.`
      case 'unknown_source': return `Sentence ${n} cites ${failure.ref}, which is not one of the career items given.`
      case 'quote_not_found': return `Sentence ${n} quotes “${failure.quote}”, which is not in ${failure.ref} word for word.`
      case 'unsupported_term': return `Sentence ${n} uses “${failure.term}”, which the items it cites do not contain.`
      case 'placeholder': return `Sentence ${n} contains the placeholder “${failure.text}”; leave that detail out.`
    }
  }).filter((line, i, all) => all.indexOf(line) === i)
}
