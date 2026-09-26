# Codex task brief template

Copy this, fill every section, delete nothing. A brief with an open architectural
decision is not ready to hand over — resolve it with Claude Code first.

---

## Task: <short imperative title>

**Milestone:** <e.g. 1.4>
**Read first:** `AGENTS.md`, `docs/conventions.md`, <other docs that apply>

### Goal

<Two or three sentences. What exists after this task that did not before, and why it
matters to the product. Not a restatement of the file list.>

### Scope

**In scope**
- <file or behavior>
- <file or behavior>

**Out of scope** — do not touch these even if they look wrong
- <file or behavior>
- <file or behavior>

### Interfaces you implement against

```ts
// Paste the exact existing interfaces. Do not make Codex infer them.
```

These already exist at `<path>`. Do not modify them. If one is wrong for the task, stop
and report it.

### Implementation notes

- <specific decision already made, so Codex does not re-decide it>
- <edge case that must be handled, and how>
- <what to do when input is ambiguous — usually: null plus a flag, never a guess>

### Dependencies

<Either: "No new dependencies." or the exact packages approved for this task.>

### Tests required

- <specific behavior> — <specific case>
- <specific behavior> — <specific case>

Adapter tests run against committed fixtures, never the live network.

### Definition of done

1. `pnpm typecheck && pnpm test && pnpm lint` all pass
2. <the task's own observable outcome>
3. <migration committed, if schema changed>

### Report back

- Files changed
- Anything you decided that this brief did not specify
- Anything you could not do, and why
- The output of the verification commands

Do not report success with failing checks. Do not loosen types, skip tests, or add `any`
to make a check pass.
