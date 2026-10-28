# Milestones

Phase 1 only. Later phases are listed at the bottom so their scope stays visible, but
nothing from them gets built yet.

**Active milestone: 2.2 drafted answers** (decision 0014), started at the owner's request
while 1.8 and 1.9 wait on the owner's checks below. 2.1 is built and merged: saved answers,
readiness and "same question" suggestions on `/answers` and each job page. 2.2's first part
is built: the assistant works only on jobs whose role fits, the profile records citizenship
and English level, and profile-fact questions are drafted in code from a model's reading of
what each asks. Its second part is built: experience answers are written from confirmed career
items and pass the grounding check before anyone sees them, under a US$0.50 daily cap, and no
answer is written for a form that asks for the candidate's own words (decision 0014,
amendments). Next: motivation drafts, then the answers page shows drafts (Codex).

**1.8 jobs UI.** 1.1 through 1.7 are closed. The jobs view is built
(`/jobs`, brief `prompts/codex/m1.8-jobs-ui.md`, implemented by Codex and reviewed): five
tabs by eligibility plus Hidden, ordered by the stated review order, each job with its
eligibility evidence and match card, and save, hide and override. **Pending:** the owner
uses it instead of LinkedIn for a week.

1.9 application tracking is built (`/applications`, decision 0012, brief
`prompts/codex/m1.9-application-tracking.md`, implemented by Codex and reviewed): mark a
job applied with the date, resume version, salary asked, contact and notes; move it
through stages in a history the database will not let anyone rewrite; read the posting
as applied to after it goes offline. **Pending:** the owner logs a real application end
to end.

1.7 closed on 2026-10-22: the owner read real job cards and judged that each explains
itself without a score. Matching (decision 0010) extracts requirements with prompt v4,
which on 20 unseen postings finds 83.9% of required skills (target 85%, shipped by the
owner's choice) with 98.9% of extractions correct (see [matching eval](matching-eval.md)).
It compares them in nine dimensions with evidence, and skips reviews that only name a
place or only wait on visa sponsorship (decision 0009, D10 and D11). Salaries stated in a
posting's text are parsed since decision 0011 (1,292 of 4,176 open postings).

1.6 passed the phase gate on 2026-10-22: the owner trusts the engine's rejections. On 84
tuning postings, prompt v3 meets every target (precision 98.6%, recall 90.0%,
needs_review 13.5%, quotes 99.4%; see [eligibility eval](eligibility-eval.md)). On a
60-posting holdout labeled before any run, it also meets every target (precision 96.4%,
recall 87.1%). Its two false rejections were one posting, fixed by engine v2. On a second
29-posting holdout labeled before any run, v2 meets every target with no false
rejections (precision 100%, recall 88.6%, needs_review 15.4%, quotes 100%).

1.5's dedupe sample measured 2.0%, at the target rather than under it; the owner
accepted it on 2026-10-21 because the only failure mode is one company's bilingual
postings. See [dedupe sample](dedupe-sample.md).

Each milestone is shippable. Nothing downstream is built until what it depends on is
trustworthy.

| # | Milestone | Owner | Done when |
| --- | --- | --- | --- |
| 1.1 | Foundation | Claude Code | A job row writes and reads through a module interface; typecheck, test, lint, and migrations all run |
| 1.2 | Candidate profile | Codex | A full profile configures through the UI with no code change, hard/preferred per field |
| 1.3 | Resume intake | Claude Code | Upload → parse → review-and-correct → verified `career_items` |
| 1.4 | Greenhouse + Lever adapters | Codex | 500+ real postings captured in `raw_jobs` on a schedule, every one normalizes without error, adapter tests on committed fixtures. Writing `jobs` rows is 1.5 |
| 1.5 | Normalization + dedupe | Claude Code | Duplicate rate under 2% on a 100-job manual sample |
| 1.6 | Eligibility v1 | Claude Code | Eval suite hits the targets in `eligibility-spec.md` |
| 1.7 | Matching | Claude Code | Every job card explains itself without a single score |
| 1.8 | Jobs UI | Codex | You use it instead of LinkedIn for a week |
| 1.9 | Application tracking | Codex | A real application is logged end to end and survives the posting going offline |

## Phase gate

After 1.6, stop and answer honestly: **do you trust the engine's rejections?**

If not, do not start 1.7. Improve the engine, expand the eval set, and re-run. Everything
downstream inherits this component's error rate, and a matching engine built over bad
eligibility data produces confident nonsense.

## Splitting work

Claude Code takes milestones involving reasoning, schema design, or LLM calls. Codex
takes milestones that are mechanical once the interface exists.

Before handing a milestone to Codex, Claude Code writes the task brief
(`prompts/codex-task-template.md`) including the exact interfaces, file paths, and
acceptance checks. A brief that leaves an architectural decision open is not ready.

## Definition of done (every milestone)

1. `pnpm typecheck && pnpm test && pnpm lint` pass
2. New behavior has tests where `conventions.md` requires them
3. Migrations generated and committed alongside the schema change
4. `docs/` updated if the change contradicts something written there
5. A decision record added if an architectural choice was made
6. The milestone's own "done when" is demonstrably true, not assumed

## Phase 2 — Assisted applications (decision 0013)

Reordered at the owner's request: the system sends the applications it can complete on its
own, hands back the rest, and keeps the tracker current from email. Starts once phase 1's
gates close; 2.1 can be planned before then.

| # | Milestone | Owner | Done when |
| --- | --- | --- | --- |
| 2.1 | Saved answers, readiness, "same question" suggestions | Claude Code + Codex | Every "Can apply" job shows whether its form could be filled from the owner's answers, names each blocking question, and suggests reusing an answer the owner gave to a differently worded question |
| 2.2 | Drafted answers (decision 0014) | Claude Code + Codex | Every question that is not a consent, demographic or no-record question gets a draft from the profile or confirmed career items, written drafts pass the grounding check, and the owner accepts or edits them |
| 2.3 | Form filling, approval mode | Claude Code + Codex | The owner submits a real Greenhouse application that the system filled, after seeing exactly what it sends |
| 2.4 | Automatic submission | Claude Code + Codex | Applications go out under the owner's rules with a stored confirmation; blocked jobs show "Apply yourself" and the reason |
| 2.5 | Read-only email | Claude Code | A real follow-up email becomes a suggested stage change the owner confirms |

Sources track, alongside (Codex): **S.1** We Work Remotely; **S.2** one remote-job API
plus cross-source duplicate detection; **S.3** adding a job by pasting its link. LinkedIn is
out of scope. Each site's terms are checked before it is added.

Never sent automatically: anything not in "Can apply", any form with a CAPTCHA, any
required question without an answer, a drafted answer unless the owner opted in, and any
drafted text for a posting that requires the candidate's own words.

## Later phases (do not build)

**Phase 3 — Application copilot.** Resume tailoring with diffs and cover letters, never
for postings that require the candidate's own words.

**Phase 4 — Intelligence.** Analytics funnel, outcome analysis by source and resume
version, daily brief.
