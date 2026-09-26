# Milestone 1.8 — Jobs UI

**Owner:** Codex (brief written by Claude Code)
**Done when:** you use it instead of LinkedIn for a week.

---

Build the jobs interface. Server components, minimal client state, no state management
library.

**Views**

1. **Jobs list** — filters for `new`, `recommended`, `strong match`, `eligible`,
   `needs review`, `saved`, `ignored`. Each card shows company, title, compensation (or
   "not stated" — never a guess), the eligibility verdict as one of three visually
   distinct states, and the top two match reasons.

2. **Job detail** — the full analysis. Eligibility verdict with its verbatim supporting
   quote displayed as a quote. Match dimensions with their evidence. The four questions
   answered plainly. The original description. A link to apply.

3. **Skipped Jobs** — this is a first-class view, not a debug screen. Every excluded job
   with its exclusion reason in plain language ("US residents only", "below your salary
   floor", "onsite required"), grouped by reason, each individually overridable. A user
   who cannot audit the filter cannot calibrate their trust in it.

4. **Needs review queue** — jobs where eligibility is uncertain, showing the specific
   open question ("the posting does not say which countries it accepts"). The user
   resolves it and the resolution is stored.

**Design constraints**

- Three eligibility states must be visually distinguishable at a glance, and not only by
  color.
- Never display a match percentage. If you find yourself wanting one, that is the signal
  the dimension evidence is not being shown well enough.
- "Not stated" and "not compatible" are different and must look different.
- The list must stay usable at 500+ jobs: pagination or virtualization, server-side
  filtering, no full-table client fetches.

Save and ignore actions write to `job_user_states`, never to the shared `jobs` table.
