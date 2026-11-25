/** Typed simulation errors (docs/TECHNICAL_ARCHITECTURE.md §10). */

export type SimErrorCode =
  | 'GEN_INVALID'
  | 'SAVE_CORRUPT'
  | 'SAVE_SCHEMA_NEWER'
  | 'INVARIANT'
  | 'WORKER_CRASH'
  | 'QUOTA'
  | 'BUDGET_EXCEEDED'
  | 'UNSUPPORTED_VERSION'
  | 'PROTOCOL';

export class SimError extends Error {
  readonly code: SimErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SimErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SimError';
    this.code = code;
    this.details = details;
  }
}

export function isSimError(e: unknown): e is SimError {
  return e instanceof SimError;
}

export function asErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'unknown error';
}
