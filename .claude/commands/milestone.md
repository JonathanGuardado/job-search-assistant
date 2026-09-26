---
description: Start work on a milestone — plan first, implement after approval
argument-hint: "[milestone number, e.g. 1.4]"
---

Start milestone $1.

Do this in order and stop where told:

1. Read `docs/milestones.md` and confirm $1 is the active milestone. If it is not, say so
   and ask whether to switch before doing anything else.
2. Read only the docs the `CLAUDE.md` table says apply to this milestone's subject.
3. Inspect the current state of the code relevant to $1. Do not assume the repo matches
   the docs — check.
4. Produce a plan containing:
   - The files you will create or change, with one line each on why
   - Any schema change, stated explicitly, with the migration it implies
   - Any new dependency, with justification
   - Any decision the milestone description leaves open, with your recommendation
   - What you will test, and what you deliberately will not test
   - Whether any part of this is mechanical enough to hand to Codex instead
5. **Stop.** Wait for approval before writing code.

If the milestone requires an architectural choice not covered by `docs/decisions/`,
present the tradeoff rather than picking one silently.
