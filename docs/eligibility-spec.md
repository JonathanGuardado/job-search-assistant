# Eligibility engine specification

Read this in full before changing anything in `src/modules/eligibility`.

The engine answers one question: **can this candidate actually take this job?** It
answers with a verdict, a confidence, and the verbatim text it relied on.

## Design

Three stages. Stage 1 is free; stage 2 reads each posting once per text version, and the
claims it produces are shared by every candidate (decision 0009).

```
job + profile
  → Stage 1: rules over structured fields
      not_eligible → verdict (a structured field proved the rejection)
      anything else → Stage 2: LLM extraction of constraints (no verdict)
                → Stage 3: the same rules over extracted claims
                    decided → verdict
                    still unknown → needs_review
```

Stage 3 runs the **same rule functions** as stage 1. The decision logic exists in exactly
one testable place, and verdicts are reproducible from stored claims without re-calling a
model.

Stage 1 never returns `eligible`. With no posting text, every claim is `unspecified`, so
a structured "eligible" only means the posting has not been read. The model reads the
title, the location line and the description, and quotes may come from any of them.

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
    countries?: string[]    // where an onsite or hybrid role is; Greenhouse has no structured country
    quote?: string
  }
}
```

Every field defaults to `unspecified`. **`unspecified` is the correct answer when the
posting is silent** — the extraction prompt must say so explicitly, because models
default to helpfully guessing.

Every `quote` is validated against the posting (title, location line and description)
after parsing. A quote that does not appear verbatim invalidates that claim, which is
then treated as `unspecified`. So does a claim that states anything **without** a quote.
This is the cheapest available hallucination check and it is not optional. The model's
output schema makes `quote` a required, nullable key on every claim, because constrained
decoding skips optional keys.

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
| `onsite-requires-relocation` | Job is onsite/hybrid, candidate will not relocate, and none of its countries (`onsite.countries`, else the structured country) is theirs |
| `remote-scope-excludes-country` | `remoteScope` names regions/countries outside where the candidate can work: their country, the countries they selected, and the regions they live in or selected. A selected region is not residence in each of its countries |
| `authorization-missing` | Authorization is required (stated, or implied by onsite/hybrid work in a country where they hold none) and sponsorship is explicitly refused. Silent on sponsorship → unknown. The candidate's own country always counts as held |
| `timezone-overlap-impossible` | Required overlap exceeds what the candidate's timezone permits (see below) |
| `employment-type-mismatch` | Job is contractor-only and candidate excludes contractor (or vice versa) |
| `salary-below-floor` | Posted max is below the candidate's floor, same currency, salary marked hard |
| `relocation-required` | Relocation required and candidate will not relocate |

Rules return `unknown` when the claim they depend on is `unspecified`. If any rule
returns `unknown` and no rule returns `fail`, the verdict is `needs_review` with those
questions attached.

Which rules may reject comes from the profile, never from code: `location` follows the
"where you can work" (`allowedRegions`) mode, `timezone`, `employmentType` and `salary`
their own modes. Authorization and relocation are always hard.

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

An assessment is recomputed when: the job's fingerprint changes (its text changed), the
digest of the profile fields the rules read changes, or `engine_version` increments.
Nothing else. Both inputs are stored on the assessment, so an unchanged pair is a no-op.
Claims are re-extracted only when the job's text changes or the prompt version does.
Store the result; do not recompute on read. At a few hundred new jobs a day, careless
reprocessing is the difference between negligible and painful monthly spend.

## Evaluation

The engine is not "done" — it is measured.

`evals/dataset.jsonl` holds hand-labeled postings, each snapshotted with its full text
and labeled for one or more reference profiles (`evals/profiles.json`) with an expected
verdict, the reason, and the verbatim sentence it rests on. A label marked
`location-only` was inferred from a bare city or country line. Aim for ~200 cases weighted
toward ambiguity: bare "Remote", US-only phrasing of both kinds, LATAM-restricted,
timezone overlap, contractor-only, relocation-required. `evals/labels-review.md` is the
readable form.

Label from the full posting, not from excerpts. When the engine disagrees with a label,
read the full text: change a label only when the text proves it wrong, and say why in its
reason. Never change one to match the engine.

The harness caches extractions per prompt version (`evals/.cache`, gitignored), so a
rule-only change re-runs for free. It never caches a failed extraction, and it waits out
provider rate limits.

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
