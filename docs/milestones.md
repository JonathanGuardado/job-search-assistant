# Milestones

Phase 1 only. Later phases are listed at the bottom so their scope stays visible, but
nothing from them gets built yet.

**Active milestone: 1.6 eligibility v1.** 1.1 through 1.5 are closed. The engine,
storage, background jobs and eval harness are built; on 84 labeled postings, prompt v3
meets every target (precision 98.6%, recall 90.0%, needs_review 13.5%, quotes 99.4%; see
[eligibility eval](eligibility-eval.md)). The owner reviewed and accepted the labels on
2026-10-21. On a 60-posting holdout labeled before any run, prompt v3 also meets every
target (precision 96.4%, recall 87.1%, needs_review 12.1%, quotes 100%). **Phase gate
pending:** the owner decides whether to trust the rejections. Jobs are normalized
from raw capture, duplicates are linked under decision 0008, and open/closed state follows
each poll. 1.5's sample measured 2.0%, at the target rather than under it; the owner
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

## Later phases (do not build)

**Phase 2 — Application copilot.** Career knowledge base, resume tailoring with diffs,
cover letters, question classification and grounded answers, approval queue, history.

**Phase 3 — Agentic applications.** Playwright flows per ATS, form understanding,
verified submission with screenshots, retries, rule-gated auto-apply.

**Phase 4 — Intelligence.** Email status parsing, analytics funnel, outcome analysis by
source and resume version, daily brief.
