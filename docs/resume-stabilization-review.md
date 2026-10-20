# Resume stabilization review

## Implemented and checked

- Upload, immutable storage, PDF/DOCX text extraction, background model extraction,
  verbatim grounding, review/correction, confirmation, and deletion are implemented.
- Confirmed career items survive deletion; drafts and parse history are removed.
- The Gemini REST JSON MIME enum is corrected. Tests use synthetic input and model stubs.
- Uploads, deletion, and file cleanup coordinate through tenant-scoped transaction locks.
- When dispatch fails after upload, the resume remains stored and the UI reports the
  failure. A producer connection fails after a bounded connection attempt rather than
  waiting indefinitely for Redis.
- Pending uploads expose Start reading on both the list and review page. Repeated
  dispatches reuse the original queue key. A failed parse uses a fresh retry key.
- Retry actions check tenant-scoped ownership and avoid requeueing a currently running
  or successful parse.

## Decision needed before closing milestone 1.3

`startParse` currently restarts a running row. The tenant transaction lock serializes the
start statements, but it does not exclusively claim the model call after commit.
Independent queue jobs or stalled-job recovery can still overlap, spending twice and
allowing an older attempt to finish or fail a newer one. A process crash can leave a run
marked running, which also blocks deletion.

Proposed decision, not implemented: add an attempt UUID and a five-minute lease to each
parse run. A worker renews the lease while active; another attempt can claim only an
expired lease. Completion and failure compare the attempt UUID so an old worker cannot
overwrite a new result. The UI may retry expired runs. This changes schema and recovery
semantics, so AGENTS.md requires an explicit decision before implementation. The owner
has been asked to choose this policy or defer it.

Manual dispatch recovery covers saved-but-never-queued uploads. It does not provide an
automatic transactional outbox or recover an indefinitely running parse.

## Remaining product limitations

Authentication is still the seeded development user. Storage is single-host local disk.
The eligibility extraction/persistence/evaluation pipeline is not connected. Candidate
settings are saved data only; they do not activate job assessment. Eligibility rule
behavior is unchanged by this work.
