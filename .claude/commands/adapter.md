---
description: Scaffold a new job source adapter with fixtures and tests
argument-hint: "[source name, e.g. ashby]"
---

Add a job source adapter for $1.

Follow the existing adapter in `src/modules/job-sources/adapters/greenhouse.ts` as the
reference implementation. The adapter implements `JobSourceAdapter` and does exactly two
things: fetch verbatim payloads, and map them to `NormalizedJob`. No eligibility logic,
no matching, no filtering.

Steps:

1. Confirm $1 exposes a public, documented endpoint. If it requires scraping or an
   authenticated API, stop and tell me — that is a different decision.
2. Fetch one real page and commit a trimmed sample to
   `src/modules/job-sources/adapters/__fixtures__/$1.json`. Redact nothing; these are
   public postings.
3. Implement `fetchPage` (cursor-based, retryable) and `normalize`.
4. Normalization rules that are not negotiable:
   - A field that cannot be parsed confidently is `null` plus its `*_source: 'unknown'`
     flag. Never guess a salary, a location policy, or an employment type.
   - Board-specific title decorations (`(Remote)`, `- LATAM`, seniority roman numerals)
     are stripped into parsed fields, not left in `title_normalized`.
   - The full description text is preserved verbatim for the eligibility engine.
5. Write tests against the fixture: one happy path, one malformed payload, one posting
   with a missing salary, one with a location the normalizer cannot classify.
6. Register the adapter in `src/modules/job-sources/registry.ts`.
7. Run `pnpm typecheck && pnpm test`.

Report what fields $1 provides that the canonical model does not capture, and what the
canonical model expects that $1 does not provide.
