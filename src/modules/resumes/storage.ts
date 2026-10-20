import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * Local-disk storage (decision 0006). Content-addressed per user, so the same
 * bytes are written once and a stored file is never overwritten. Single-host
 * only: move to object storage before running more than one app instance.
 */

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The key is built only from a uuid and a hex digest, so it cannot escape the root. */
export function storageKeyFor(userId: string, contentSha256: string): string {
  return `resumes/${userId}/${contentSha256}`
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function storeFile(root: string, key: string, bytes: Uint8Array): Promise<void> {
  const path = join(resolve(root), key)
  if (await exists(path)) return
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // Write-then-rename, so a crash never leaves a truncated file under the final key.
  const temporary = `${path}.${randomUUID()}.partial`
  await writeFile(temporary, bytes, { mode: 0o600 })
  await rename(temporary, path)
}

export async function removeFile(root: string, key: string): Promise<void> {
  await rm(join(resolve(root), key), { force: true })
}
