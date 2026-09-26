# Milestone 1.7 — Matching

**Owner:** Claude Code
**Done when:** every job card explains itself without showing a single score.

---

Implement match analysis over jobs that passed eligibility. Do not assess matches for
jobs that are `not_eligible`.

**No overall score column.** The analysis is per-dimension, each with a verdict and named
evidence:

| Dimension | Question |
| --- | --- |
| Hard requirements | Any disqualifying gap — years, authorization, must-have tech |
| Core skills | Overlap between required stack and verified experience |
| Seniority | Does the level fit the track record |
| Domain | Relevant industry or product context |
| Compensation | Does the posted range clear the floor |
| Preferences | Technologies, company type, arrangement |

Hard requirements are evaluated separately and never averaged into anything. A role
requiring an active security clearance is not a 90% match for a candidate without one.

**Compensation handling:** an unstated salary is `unknown`, never inferred from title and
location. A fabricated estimate presented with confidence is worse than a blank field.

**Evidence, not adjectives.** "Matches because you have 6 years of Node.js across three
roles" beats "strong technical fit". Every claim about the candidate traces to a
`career_item`; the same grounding rule as generation applies here.

**The four questions** every job card answers directly: why this matched, which required
skills are missing, what concerns a recruiter might raise, and whether compensation is
compatible.

If the UI needs an ordering, derive it at query time from the dimensions and make the
derivation visible to the user. Do not persist a score — a stored number gets treated as
truth six weeks later.

Also implement the override path: a user can override any eligibility exclusion, the
override is stored with its reason, and repeated overrides against one rule id surface in
the eval report.
