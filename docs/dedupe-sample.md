# Dedupe sample — milestone 1.5

**Date:** 2026-10-21
**Data:** 4,189 postings from 26 boards (Greenhouse and Lever), captured 2026-10-20 and
2026-10-21; 4,174 open canonical jobs after linking.
**Rule:** decision 0008. A duplicate is the same posting listed twice.
**Target:** a duplicate rate under 2% on a manually checked 100-job sample.

## Method

`pnpm jobs:sample <seed>` draws 100 open canonical jobs (the list a user would see) in a
seed-determined order. For each one, it lists every other open canonical job at the same
company with the same normalized title, seniority, location policy and location text,
along with the words only one of the two contains. Each pair was judged by one question:
would a job seeker call these the same opening? A pair judged "same" is a missed
duplicate. The rate is sampled jobs with at least one missed duplicate, out of 100.

The look-alike query is the scope of the check. Duplicates with different titles or
location strings (for example a title translated into another language) are not
surfaced, and are not counted.

## Result

**Primary sample (seed `2026-10-21`): 2 missed duplicates in 100, a rate of 2.0%. This
is at the target, not under it.**

| # | Job | Look-alike difference | Judgment |
| --- | --- | --- | --- |
| 23 | Datadog, Field CTO (Japan), Tokyo | Japanese vs English text | Same opening: **missed** |
| 31 | Datadog, Strategic Account Executive, Public Sector Japan, SLED, Tokyo | Japanese vs English text | Same opening: **missed** |
| 55 | Twilio, Technical Account Manager 3, Remote Colombia | Eastern vs Pacific working hours | Different openings: correct |

The other 97 sampled jobs had no look-alike.

**Second sample (seed `2026-10-21-b`), drawn for context: 1 missed in 100 (1.0%).**
That was Datadog's Commercial & Mid-Market Sales Engineer in Tokyo (Japanese vs
English). The other look-alikes were correctly kept apart: Stripe's Integration Engineer
(5 vs 10) and Twilio's Technical Support Engineer 2 (different shift days, and two
different roles with that title).

**Full audit.** Every look-alike pair among all 4,174 open canonical jobs: 68 pairs.

| Kind | Pairs | Judgment |
| --- | --- | --- |
| Same role, one description in English and one in Japanese or Korean (all Datadog) | 16 | Missed duplicates |
| Same role, several requisitions with differently worded templates (MongoDB, one Stripe pair) | ~7 | Missed, but harmless: identical constraints |
| Material difference: hours, shifts, territory, experience, office proximity | ~11 | Correctly kept apart |
| Different roles sharing a title and location | ~34 | Correctly kept apart |

About 23 extra listings across 4,174 jobs is roughly **0.55% of the visible list**. The
primary sample's 2.0% comes from two of the 16 bilingual pairs landing in one 100-job
draw.

## Dominant failure mode

**Bilingual postings.** Datadog publishes each Japan and Korea role twice, in English and
in Japanese or Korean. The descriptions share no text, so the exact-text rule cannot link
them. All three missed duplicates across both samples are this mode.

The threshold was not tuned to improve this number: decision 0008 has no threshold. Two
changes were made while measuring, and both make the rule stricter, so they cannot lower
the rate:

- Seniority joined the fingerprint (Elastic posts Senior and Principal versions of one
  title).
- Level numerals stay in the title (Brex posts "Sourcer" and "Sourcer II").

The primary sample was drawn before the second change and redrawn after it, with the
same result.

## Decision

On 2026-10-21 the owner chose option 1: the result is accepted and 1.5 is closed. The
bilingual mode stays a known limitation; revisit it if more multi-language boards are
added.

## Options considered

1. **Accept, and close 1.5.** The only failure mode is one company's bilingual postings,
   about 0.4% of the list, and its cost is a duplicate row, not a hidden job.
2. **Link bilingual postings.** Treat same company, title, seniority and location as one
   posting when one description is mostly CJK or Hangul and the other mostly Latin. This
   is a heuristic: two different Tokyo openings with one title, one described in
   Japanese, would be merged.
3. **Leave the rule, and revisit** when a second source or language gives more data.
