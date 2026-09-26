# Milestone 1.3 — Resume intake

**Owner:** Claude Code
**Done when:** upload → parse → review-and-correct → verified `career_items` works end to
end, and parsed output is accurate after one human pass.

---

Implement resume upload, parsing, and the correction step.

Three pieces:

**1. Storage.** Files go to object storage; `resumes` rows are immutable versions. A
re-upload is a new version, never an edit. Support PDF and DOCX.

**2. Parsing.** Extract text, then one `resume.parse` LLM task returning structured
`career_items` against a Zod schema. Rules:

- The model extracts what is written. It does not infer seniority, expand acronyms,
  normalize job titles, or estimate dates it cannot see.
- A field it cannot find is null. "Present" for an end date is a real value; a guessed
  end date is not.
- Every extracted achievement carries the source text span it came from, validated to
  appear verbatim in the extracted text. Same discipline as the eligibility engine.

**3. The review step.** This is the milestone's real deliverable, and it is easy to
underbuild. The user sees each parsed item beside its source text, edits anything wrong,
and confirms. Confirmation sets `verified_by_user`.

`verified_by_user` is load-bearing: unverified items may be used for matching, but may
never ground generated text in phase 2. Enforce this at the service boundary now, while
it is cheap, rather than remembering to do it later.

Do not build resume tailoring, cover letters, or any generation. That is phase 2.

Tests (test-first): the verbatim span validation, the unverified-items-cannot-ground
invariant, and version immutability.
