# Milestone 1.6 — Eligibility engine v1

**Owner:** Claude Code
**Done when:** the eval suite hits every target in `docs/eligibility-spec.md`.

---

This is the milestone the product exists for. Read `docs/eligibility-spec.md` in full
before writing anything, and follow it exactly — it is a specification, not a suggestion.

**Build order, and it matters:**

1. **The labeled dataset first.** Before implementing anything, hand-label 60 real
   postings from the ingested data in `evals/dataset.jsonl`. Weight toward ambiguity:
   bare "Remote" with no other signal, "US-based only", "must be authorized to work in
   the US", LATAM-restricted, timezone overlap requirements, contractor-only, hybrid
   disguised as remote. Include the expected verdict and the reason.

   Labeling first prevents the engine from being built to match its own output. Grow the
   set to ~200 over the milestone.

2. **The rules, test-first.** Pure functions against the `Rule` interface, tested with
   synthetic claims before any model is involved. Every rule returns `unknown` when the
   claim it reads is `unspecified`.

3. **Stage 1** — rules over structured job fields. Measure how many jobs this decides
   with no model call. Report the number; it is the cheapest quality signal you have.

4. **Stage 2** — the extraction task. The model extracts claims with verbatim quotes and
   renders no verdict. Validate every quote against the source text; an unvalidated quote
   invalidates its claim, which becomes `unspecified`.

5. **Stage 3** — the same rule functions over extracted claims.

6. **The eval harness** — `pnpm eval:eligibility`, reporting all four metrics with
   per-case failures.

**The trap to watch:** "US-based only" and "must be authorized to work in the US" are
different constraints. The first restricts location; the second is an authorization
requirement a candidate may satisfy via visa or EOR. Conflating them is the single most
common source of false rejections. Build eval cases for both phrasings before writing the
extraction prompt, and treat a regression there as a release blocker.

**Do not** let the model produce verdicts, even as a "fallback" for hard cases. If the
rules cannot decide, the answer is `needs_review`. That is the correct answer, not a
failure to be engineered around.

When the eval passes, stop and report the numbers before starting 1.7. If precision on
`not_eligible` is below 0.95, the phase gate in `docs/milestones.md` applies.
