# Eligibility engine specification

Read this in full before changing anything in `src/modules/eligibility`.

The engine answers one question: **can this candidate actually take this job?** It
answers with a verdict, a confidence, and the verbatim text it relied on.

## Design

Three stages, each cheaper and more reliable than the next. Most jobs never reach a model.

```
job + profile
  → Stage 1: rules over structured fields
      decided → verdict
      unknown → Stage 2: LLM extraction of constraints (no verdict)
                → Stage 3: the same rules over extracted claims
                    decided → verdict
                    still unknown → needs_review
```

Stage 3 runs the **same rule functions** as stage 1. The decision logic exists in exactly
one testable place, and verdicts are reproducible from stored claims without re-calling a
model.

## Verdicts

| Verdict | Meaning | Behavior |
| --- | --- | --- |
| `eligible` | Constraints found and satisfied | Ranked normally |
| `not_eligible` | A hard constraint is violated, with a supporting quote | Hidden; listed in Skipped Jobs with its reason |
| `needs_review` | Constraints absent, contradictory, or low confidence | Surfaced with the open question named |

**Never collapse the third state.** A posting that says "Remote" and nothing else is
genuinely ambiguous. Assuming eligible wastes the user's time; assuming ineligible hides
real opportunities, which is worse because it is invisible to the user.

`not_eligible` requires a quote. If no sentence in the posting supports the rejection,
the verdict is `needs_review`, not `not_eligible`.

## Claims

Stage 2 extracts claims, never conclusions. The model's entire job is reading
comprehension.

```ts
type EligibilityClaims = {
  remoteScope: {
    kind: 'worldwide' | 'regions' | 'countries' | 'none' | 'unspecified'
    regions?: string[]      // 'latam' | 'emea' | 'apac' | 'namer'
    countries?: string[]    // ISO 3166-1 alpha-2
    quote?: string          // verbatim, must appear in the source text
  }
  authorization: {
    required: boolean | 'unspecified'
    countries?: string[]
    sponsorshipOffered?: boolean | 'unspecified'
    quote?: string
  }
  timezone: {
    kind: 'overlap' | 'fixed' | 'none' | 'unspecified'
    reference?: string      // e.g. 'America/Los_Angeles'
    overlapHours?: number
    quote?: string
  }
  employmentType: {
    kind: 'employee' | 'contractor' | 'eor' | 'either' | 'unspecified'
    quote?: string
  }
  relocation: {
    required: boolean | 'unspecified'
    assistanceOffered?: boolean | 'unspecified'
    quote?: string
  }
  onsite: {
    kind: 'onsite' | 'hybrid' | 'remote' | 'unspecified'
    daysInOffice?: number
    quote?: string
  }
}
```

Every field defaults to `unspecified`. **`unspecified` is the correct answer when the
posting is silent** — the extraction prompt must say so explicitly, because models
default to helpfully guessing.

Every `quote` is validated against the source text after parsing. A quote that does not
appear verbatim invalidates that claim, which is then treated as `unspecified`. This is
the cheapest available hallucination check and it is not optional.

## Rules

Each rule is a pure function. Rules are ordered; the first `fail` wins.

```ts
type RuleInput = { profile: CandidateProfile; job: Job; claims: EligibilityClaims }
type RuleOutcome =
  | { kind: 'pass' }
  | { kind: 'fail'; reason: string; quote?: string }
  | { kind: 'unknown'; question: string }

type Rule = { id: RuleId; appliesWhen: (i: RuleInput) => boolean; evaluate: (i: RuleInput) => RuleOutcome }
```

A rule only produces `fail` when the corresponding profile field is marked `hard` in
`constraint_modes`. A `preferred` field that mismatches is passed through to `matching`
as a concern, never as a rejection.

### Rule set (phase 1)

| Rule id | Fails when |
| --- | --- |
| `onsite-requires-relocation` | Job is onsite/hybrid, candidate will not relocate, and location is outside their country |
| `remote-scope-excludes-country` | `remoteScope` is regions/countries and the candidate's country is in neither |
| `authorization-missing` | Authorization required in a country where the candidate holds none, and sponsorship is not offered |
| `timezone-overlap-impossible` | Required overlap exceeds what the candidate's timezone permits (see below) |
| `employment-type-mismatch` | Job is contractor-only and candidate excludes contractor (or vice versa) |
| `salary-below-floor` | Posted max is below the candidate's floor, same currency, salary marked hard |
| `relocation-required` | Relocation required and candidate will not relocate |

Rules return `unknown` when the claim they depend on is `unspecified`. If any rule
returns `unknown` and no rule returns `fail`, the verdict is `needs_review` with those
questions attached.

### Timezone arithmetic

Compute the overlap between the candidate's working window (default 09:00–18:00 local)
and the required reference window. Fail only when the achievable overlap is less than the
required hours **and** the shortfall exceeds one hour, to absorb loose phrasing like
"significant overlap with PST". Below that margin, return `unknown`.

### The US-only trap

"US-based only" and "must be authorized to work in the US" are different constraints. The
first is a location restriction; the second is an authorization requirement that a
candidate on a visa or through an EOR may satisfy. The extraction prompt must
distinguish them, and `remote-scope-excludes-country` must not fire on authorization
language alone. This is the single most common source of false rejections — treat a
regression here as a release blocker.

## Confidence

```
1.0   structured fields decided it, no model involved
0.8   claims extracted with validated quotes, rules decided cleanly
0.6   claims extracted, quotes partially validated
< 0.6 → needs_review regardless of what the rules returned
```

Confidence is computed by code from stage provenance, never asked of the model.

## Recomputation

An assessment is recomputed when: the job's description hash changes, the candidate's
profile changes in a field a rule reads, or `engine_version` increments. Nothing else.
Store the result; do not recompute on read. At a few hundred new jobs a day, careless
reprocessing is the difference between negligible and painful monthly spend.

## Evaluation

The engine is not "done" — it is measured.

`evals/dataset.jsonl` holds hand-labeled postings, each with an expected verdict and the
reason. Aim for ~200 cases weighted toward ambiguity: bare "Remote", US-only phrasing of
both kinds, LATAM-restricted, timezone overlap, contractor-only, relocation-required.

`pnpm eval:eligibility` reports:

| Metric | Target | Why |
| --- | --- | --- |
| Precision on `not_eligible` | ≥ 0.95 | A false rejection is a job the user never sees |
| Recall on `not_eligible` | ≥ 0.80 | Missing a rejection only costs attention |
| `needs_review` share | ≤ 0.25 | Higher means the engine is not earning its keep |
| Quote validation rate | ≥ 0.98 | Below this, extraction is hallucinating |

Precision on `not_eligible` is the metric that matters most and is weighted accordingly.

Any change to prompts or rules requires an eval run before and after, and the comparison
goes in the PR description. A change that improves recall while dropping precision below
target is rejected.

## User overrides

Every exclusion is overridable from the Skipped Jobs view, and every override is stored
on the assessment with its reason. A pattern of overrides against one rule id is the
clearest signal available that the rule is wrong — surface it in the eval report rather
than waiting to notice it by hand.
