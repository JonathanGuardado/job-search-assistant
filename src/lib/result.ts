/**
 * Domain code returns results; it does not throw for expected failures.
 * Throwing is reserved for edges where a framework catches it.
 */

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export type DomainErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'conflict'
  | 'upstream_failed'
  | 'validation_failed'

export type DomainError = {
  readonly code: DomainErrorCode
  readonly message: string
  readonly cause?: unknown
}

export const domainError = (
  code: DomainErrorCode,
  message: string,
  cause?: unknown,
): DomainError => (cause === undefined ? { code, message } : { code, message, cause })

/** Throw at an edge. Never call this inside a module's service layer. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value
  throw new Error(`unwrap called on error result: ${JSON.stringify(result.error)}`)
}
