# 0006 — Resume files on local disk, for now

**Status:** accepted
**Date:** 2026-09-25

## Context

Milestone 1.3 stores uploaded resumes. The milestone prompt and the original
`.env.example` assumed S3-compatible object storage. Three options were weighed:

- **S3-compatible storage, with MinIO locally.** The same code runs in development and
  production. Cost: the AWS SDK, a MinIO container, and tests that depend on it.
- **Postgres `bytea`.** No new infrastructure, the file is transactional with its row,
  and RLS protects the bytes too. Cost: the database grows with every upload, and it
  departs from the prompt.
- **Local filesystem.** No dependencies. It serves one host only.

## Decision

Local filesystem, chosen by the project owner for milestone 1.3.

- Files live under `STORAGE_DIR` (default `.data/storage`, gitignored) at
  `resumes/<user_id>/<sha256>`. The key is built only from a UUID and a hex digest, so
  it can't escape the root.
- Storage is content-addressed and write-once. An existing key is never overwritten, and
  writes go to a temporary file that is then renamed, so a crash never leaves a
  truncated file under a real key.
- Files are written before their row. An orphaned file is harmless; a row without its
  file isn't.
- There is no read path yet. Nothing in phase 1 needs the original bytes back, because
  the extracted text is stored on the row.

## Consequences

- **Single host only.** Before running more than one app or worker instance, or any
  host with ephemeral disk, move to object storage. The migration is mechanical: copy
  the objects under the same keys, then swap `storage.ts`. `storage_key` already holds
  the object key.
- The file system doesn't enforce tenant isolation the way RLS does. Access goes only
  through the `resumes` service, which resolves a key from an RLS-protected row. The
  directory must not be served statically.
- Backups must include `STORAGE_DIR`, not only the database.
- User-requested deletion removes the stored file after the database transaction commits,
  only if no remaining resume version references it. Uploads and cleanup share a tenant
  transaction lock so cleanup cannot remove a concurrently re-uploaded file. If cleanup
  fails, the UI reports that the resume was deleted but its file could not be removed.
- Revisit when the app is first deployed, or when phase 2 needs to return the original
  file (tailored-resume downloads).
