# Matching eval — milestone 1.7

**Date:** 2026-10-22
**Dataset:** `evals/matching-labels.jsonl`, 25 postings from `evals/dataset.jsonl` (20
engineering and data roles; 5 others: finance, support, sales, design, SEC reporting),
labeled from full text and committed before the prompt read any of them (commit 0766ff5).
**Model:** `gemini-3.5-flash-lite`. **Run:** `pnpm eval:matching`. **Cost:** $0.05.

The comparison that follows extraction is deterministic and unit-tested; this measures
whether the model returns the skills, years and languages a careful reader would list.
Each label lists required and preferred skills ("A | B": naming either counts), skills
that are not wrong to extract, overall years, and spoken languages.

## Results (prompt v1, one run)

| Metric | Value | Target |
| --- | --- | --- |
| Quote validation rate | **100%** (236/236) | ≥ 98% |
| Required skills found | **85.7%** (60/70) | ≥ 85% |
| …of those, read as required | 93.3% (56/60) | report |
| Preferred skills found | 86.5% (32/37) | report |
| Extracted skills a label allows | 97.2% (139/143) | report |
| Overall years exactly right | 92.0% (23/25) | report |
| Languages found | 100% (15/15) | report |

Both targets are met, recall by a narrow margin: one more miss would fail it.

The first scoring counted "read as required" at 88.3%. Tracing it found a comparison bug,
not a model error: a posting that requires a skill and also lists it as a plus (Wizeline's
Kubernetes) put it on the card twice, once under each heading. A skill required anywhere
is now required (engine change before any user saw a card; re-scored from cache).

## What the misses are

A missed requirement is left off the card; it never becomes a false "missing". Precision
is the safer number here: 97% of extracted skills are ones a label allows, so the
"missing" lists rarely show something the posting does not ask for.

- **Concepts rather than tools are skipped.** Microservices (twice), REST, object-oriented
  programming.
- **Standards land in "other".** Coinbase's "US GAAP" and "SOX" were returned inside one
  long other-requirement sentence, so the card shows them as *not compared*.
- **A platform named only through its parts.** Elastic's Salesforce DevOps role yielded
  Apex, LWC and SOQL but not Salesforce itself, nor Git or CI/CD.
- **Years tied to a skill read as overall** (twice): "5+ years with .NET/C#" became 5+
  years of experience.
- **iOS** was not listed alongside Swift and SwiftUI.

## Prompt v2–v4: "one of these" requirements (after reading real cards)

The owner's first real cards (`pnpm match:explain`) showed failures the v1 metrics did not
weigh: "AWS, Azure, OCI, or GCP" as four missing required skills; "Missing required: Go" for
a posting accepting any of six languages the owner mostly has; generic areas ("networking",
"API design", "data modeling") as skills a resume can never show; a duty ("ensure
Salesforce hygiene") read as a requirement. Prompt v2 returns a skill requirement as a list
of names any one of which satisfies it, keeps generic areas in "other", and reads only the
qualification sections; comparison engine v2 meets a requirement through any of its names.

| Run (25 tuning postings) | Required found | Read as required | Allowed by labels | Years | Languages |
| --- | --- | --- | --- | --- | --- |
| v1 | 85.7% | 93.3% | 97.2% | 92% | 100% |
| v2: any-of skills, generic areas to "other" | 81.4% | 100% | 100% | 96% | 93% |
| v3: name skills found inside longer sentences | 84.3% | 100% | 100% | 96% | 100% |
| **v4: anything with a proper name is a skill** | **94.3%** | 98.5% | 99.2% | 92% | 100% |

These 25 postings shaped v2–v4, so their numbers are optimistic.

### Holdout (prompt v4, one run)

20 postings never read by any prompt version, labeled from full text and committed first
(commit ae7025c): 62 required-skill groups, 8 language requirements.

| Metric | Holdout | Target |
| --- | --- | --- |
| Quote validation rate | **100%** (198/198) | ≥ 98% |
| Required skills found | **83.9%** (52/62) | ≥ 85% |
| …read as required | 96.2% (50/52) | report |
| Extracted skills a label allows | 98.9% (181/183) | report |
| Overall years exactly right | 100% (20/20) | report |
| Languages found | 100% (8/8) | report |

**Recall misses the target by one requirement** (53 of 62 would pass). The misses:

- **A named skill next to a generic word.** "Database technologies (SQL and NoSQL)" lost
  SQL and NoSQL: v4 lists "databases" as a generic area. A conflict the prompt created.
- **Named standards and frameworks filed as "other":** ASC 606, IFRS 15, SOC 2 / ISO 27001
  / GDPR, MLOps / LLMOps.
- **Linux, shell scripting, macOS, prompt engineering** were not listed.
- **"C/C++" returned as one name.** Its key matches neither C nor C++, so a C++ developer
  would see it as missing. A comparison bug, not counted by this metric.

A miss leaves a requirement off the card; it does not add a false gap. The failures the
owner saw on real cards (any-of skills, generic areas, duties) are fixed, and 99% of what
v4 extracts is right. Known limitation found while labeling: spoken languages have no
any-of form, so "German or French" reads as both required.

## Caveats

- **One set, now seen.** These 25 postings shaped nothing yet, so this run is unbiased.
  A prompt v2 aimed at the misses above would be measured on them and would need fresh
  labels to confirm, as eligibility did (`docs/eligibility-eval.md`).
- **Size.** 70 required-skill groups: one miss moves recall by about 1.4 points.
- **Aliases were added before the run**, from spellings seen while labeling ("K8",
  "Apache Kafka", "OOP"), not from the model's output.
