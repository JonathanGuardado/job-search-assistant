---
description: Turn a piece of work into a self-contained Codex task brief
argument-hint: "[what Codex should build]"
---

Write a Codex task brief for: $ARGUMENTS

Use the structure in `prompts/codex-task-template.md`. The brief must be self-contained —
Codex will read it alongside `AGENTS.md` and the docs it names, and nothing else from
this conversation.

Before writing it, verify that the work is actually ready to delegate:

- Every interface Codex will implement against already exists in the repo, or is written
  out in full inside the brief.
- No architectural decision is left open. If one is, resolve it with me first.
- The acceptance checks are mechanically verifiable, not judgement calls.

If the work is not ready to delegate, say what is missing instead of writing the brief.

Output the brief as a fenced markdown block I can copy, and save it to
`prompts/codex/<short-slug>.md`.
