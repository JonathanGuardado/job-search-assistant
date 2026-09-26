# Milestone 1.2 — Candidate profile

**Owner:** Codex (brief written by Claude Code)
**Done when:** a complete profile configures through the UI with no code change, and each
constraint is independently markable hard or preferred.

---

Implement the `profiles` module and its settings UI.

The schema is specified in `docs/domain-model.md` under `candidate_profiles`. Implement
it exactly; if a field there seems wrong, report it rather than changing it.

The part that matters most is `constraint_modes`. Every constraint field is independently
markable as `hard` or `preferred`, per user. This is what makes the product configurable
rather than tuned to one person:

- A `hard` constraint can produce `not_eligible` in the eligibility engine.
- A `preferred` constraint can only lower a match dimension and surface as a concern.
- Nothing about which fields are hard is decided in code.

Some fields are inherently hard and cannot be downgraded: work authorization and
relocation willingness. Enforce that in the type, not in the UI.

UI requirements:

- One page, sectioned: location and authorization, compensation, roles and seniority,
  work arrangement, technology preferences, company exclusions.
- Each constraint row shows its hard/preferred toggle inline, with a one-line explanation
  of what the toggle does. Users will not read documentation.
- Salary is entered in a currency the user picks and stored as integer minor units.
- Validation is Zod-based and shared between the form and the server action.

No eligibility logic here. The profile is data; the rules that read it live in
`src/modules/eligibility`.

Tests: the constraint_modes round-trip, currency conversion to minor units, and the
invariant that authorization and relocation cannot be set to `preferred`.
