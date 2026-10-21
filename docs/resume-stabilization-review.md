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

## Parse ownership (resolved)

The owner approved the lease policy, recorded as decision 0007 and implemented in
migration `0006_parse-run-leases`. Each claim gets an attempt id and a five-minute lease
that the worker renews during the model call. Overlapping jobs for a run under a live
lease end without calling the model. An attempt that lost its lease cannot complete or
fail the run. A run whose worker died shows as stopped after the lease lapses, and can be
retried or deleted.

Manual dispatch recovery covers saved-but-never-queued uploads. There is still no
automatic transactional outbox, and stalled runs are retried by the user, not
automatically.

## Remaining product limitations

Authentication is still the seeded development user. Storage is single-host local disk.
The eligibility extraction/persistence/evaluation pipeline is not connected. Candidate
settings are saved data only; they do not activate job assessment. Eligibility rule
behavior is unchanged by this work.
