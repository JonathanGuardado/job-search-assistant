# 0015 — Two configured models by role; both providers at once

**Status:** accepted
**Date:** 2026-10-27

## Context

The app ran every task on one provider, chosen in `.env.local` (`AI_PROVIDER`,
`MODEL_EXTRACTION`, `MODEL_REASONING`). On 2026-10-27 the Gemini prepaid credit ran out
(HTTP 402), mostly spent on reading every posting once for eligibility and matching. The
owner switched `.env.local` to DeepSeek to save money and asked not to switch by hand again.

The two providers are not interchangeable. Measured the same day:

- **Eligibility, DeepSeek Flash fails.** Precision on `not_eligible` 93.2% on the holdout
  (target ≥ 95%; Gemini 96.4%, 100% after engine v2), with seven false rejections across
  all splits, every one of them the owner's. It narrows regions to example countries:
  "Canada, Central America, South America" became CA, MX, BR, hiding Toptal jobs the owner
  can take; "AMER or EMEA time zones" became North America and EMEA.
- **Matching, DeepSeek Flash passes**, better than Gemini did: required skills found 97.7%
  (target ≥ 85%; Gemini 83.9% on the v4 holdout), quotes 100%.
- **Price.** About $0.0006 per posting for DeepSeek against $0.0012 for Gemini in the
  eligibility eval: real, but small next to a false rejection.

## Decision

**Two roles, configured in `.env.local`.** Each role has a provider, a model and a key:
`AI_PRIMARY_PROVIDER`, `AI_PRIMARY_MODEL`, `AI_PRIMARY_API_KEY`, and the same for
`AI_SECONDARY_*`. The owner's choice: what model runs is a setting next to its key, so
switching models never means editing code, and code never names a provider or a model.
Either provider can fill either role. `AI_PROVIDER`, `AI_API_KEY`, `MODEL_EXTRACTION`,
`MODEL_REASONING` and model tiers are gone.

**Each task names its role in its prompt file** (`role: 'primary'`), next to its version.
Moving a task to the other role is a code change.

| Task | Role | Why |
| --- | --- | --- |
| `eligibility.extract-claims` | primary | Needs the model that passes the eligibility eval |
| `career-knowledge.extract-resume` | primary | Personal data; goes to the provider trusted with it |
| `matching.extract-requirements` | secondary | Runs on every posting; cheap model, eval-checked |
| `application-answers.read-questions` | secondary | Public question wording only; every draft is accepted by the owner (0014) |
| `application-answers.match-questions` | secondary | Question wording only, never answers; every pair is accepted by the owner (0013) |

Configured on 2026-10-27: primary is Gemini Flash Lite (Google's paid tier does not train
on the resume; DeepSeek stores data in China), secondary is DeepSeek Flash.

**Changing a role's model calls for its eval.** Because it is a setting, no review stops a
model that fails: `.env.example` says to run `pnpm eval:eligibility` after changing the
primary model and `pnpm eval:matching` after changing the secondary. The evals read the same
settings and store extractions per model, so they always measure what is configured.

**No fallback between roles.** When one provider fails or runs out of credit, its tasks
wait and retry; they never run on the other role. A fallback would quietly put eligibility
on a model that hides jobs.

**Out of credit says so.** HTTP 402 stays `upstream_failed`, so callers write nothing and
the queue retries, but its message reads "out of credit" instead of a bare status code.

Readings already stored stay valid: every trace records the provider and model that made it,
and changing a model does not bump a task's version, so stored extractions are not redone.

## Consequences

- Both roles must be configured for the whole app to work. Without the secondary, matching
  and question drafting stop; without the primary, eligibility and resume reading stop.
- A model that fails eligibility can be configured without any check stopping it. The guard
  is the eval instruction in `.env.example` and the model recorded on every trace.
- `deepseek-flash` is an alias DeepSeek moves to newer models. Traces record what was asked
  for, not what answered; a silent model change shows up only when an eval is re-run.
- A third provider means an adapter, a `PROVIDER_NAMES` entry and the provider list in
  `src/lib/env.ts`; it can then fill either role.
