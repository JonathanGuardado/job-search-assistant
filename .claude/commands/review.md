---
description: Review changes against the project's non-negotiable rules
argument-hint: "[optional: branch, PR, or path]"
---

Review $ARGUMENTS (default: uncommitted changes plus the current branch's diff against
main).

Check against the project's rules, in this order of severity:

**Reject without discussion**
- A module importing another module's internals rather than its `index.ts`
- A query touching a per-user table without a tenant filter
- A mutation of `raw_jobs`
- Generated text that could contain a claim absent from `career_items`
- An LLM call producing a verdict, score, or action rather than structured data
- A code path that converts `needs_review` into `eligible` or `not_eligible`
- `any`, a non-null assertion outside tests, or an `as` cast not immediately after a Zod parse

**Flag for discussion**
- A new npm dependency
- An abstraction with only one caller
- A new LLM call where deterministic code could answer
- A schema change that is not purely additive
- A missing test where `docs/conventions.md` requires test-first
- A `TODO` that does not name a resolving milestone

**Note briefly**
- Naming that needs a comment to explain it
- Functions over ~50 lines without a reason
- Comments restating the code

For each finding: the file and line, what is wrong, and the concrete fix. Rank by
severity. If nothing in the first two categories applies, say so plainly rather than
manufacturing findings.
