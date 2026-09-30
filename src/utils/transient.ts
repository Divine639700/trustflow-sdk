/**
 * Shared classification of "is this failure worth retrying?".
 *
 * Every retried call site in the SDK (Horizon reads, Soroban RPC calls, raw
 * `fetch` helpers, the backend HTTP client and `TransactionPipeline`) funnels
 * through {@link classifyFailure} so a transient blip is retried everywhere
 * and a deterministic rejection is never retried anywhere. The rules encode
 * the idempotency policy from
 * `docs/spikes/issue-79-retry-session-multisig.md` §2:
 *
 * | Failure                                       | Retried? |
 * |-----------------------------------------------|----------|
 * | Transport error (`ECONNRESET`, DNS, TLS, offline) | Yes |
 * | Timeout (`ETIMEDOUT`, `ECONNABORTED`, `AbortError`) | Yes |
 * | `429`, `408`, `5xx`                            | Yes |
 * | Soroban node `TRY_AGAIN_LATER` / `tx_too_early` | Yes |
 * | `4xx` other than `408`/`429`                  | No  |
 * | Simulation error (`Error(Contract, #n)`)      | No  |
 * | Node `ERROR` / on-chain `FAILED`              | No  |
 */

/** Why a failure happened, and therefore whether retrying can help. */
export type TransientFailureKind =
  /** Transport-level failure: connection reset/refused, DNS, TLS, offline. */
  | 'network'
  /** The request exceeded a client or server timeout. */
  | 'timeout'
  /** `429` — the server asked the caller to slow down. */
  | 'throttled'
  /** `5xx` — the server failed to handle an otherwise valid request. */
  | 'server'
  /** The Soroban node explicitly deferred the transaction (`TRY_AGAIN_LATER`). */
  | 'node-busy'
  /** A protocol-level rejection that will fail identically on every attempt. */
  | 'deterministic'
  /** Unrecognised error; treated as a transport failure (see {@link classifyFailure}). */
  | 'unknown';

/** Result of {@link classifyFailure}. */
export interface TransientFailure {
  kind: TransientFailureKind;
  /**
   * Whether another attempt could plausibly succeed.
   *
   * An unrecognised error is reported as transient (`kind: 'unknown'`): every
   * retried call site in the SDK awaits an HTTP or RPC transport, so a raw
   * `throw` from one of them is a transport failure unless it carried a
   * recognisable protocol-level signal.
   */
  transient: boolean;
  /** HTTP status code, when the failure carried one. */
  status?: number;
  /** Server-requested delay parsed from `Retry-After`, in ms. */
  retryAfterMs?: number;
  /** Short human-readable explanation, useful for logs. */
  reason: string;
}

const TRANSIENT_MARKER = Symbol.for('trustflow.transient');

/**
 * Network error codes emitted by Node's `net`/`dns`/`http` stacks, by
 * `undici` (Node 18+ global `fetch`) and by axios' XHR adapter in browsers.
 */
const TRANSIENT_ERROR_CODES = new Set([
  'ABORTED',
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'EPROTO',
  'ERR_NETWORK',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** `fetch()` rejects with a bare `TypeError` (message varies by runtime). */
const TRANSIENT_FETCH_MESSAGES = [
  'failed to fetch',
  'load failed',
  'network error when attempting to fetch resource',
  'network request failed',
  'terminated',
];

/**
 * Node-side signals that the transaction was *not* accepted, so resubmitting
 * the identical envelope is safe. Deliberately narrow: a bare "timed out" is
 * not listed here, because it is ambiguous (the transaction may already be on
 * ledger) and the pipeline decides that case explicitly instead.
 */
const NODE_BUSY_PATTERN = /TRY_AGAIN_LATER|tx_too_early|tx_busy|too early|ledger (?:is )?busy/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Walks an error's `cause` chain so HTTP metadata attached to a wrapped
 * failure is still visible. Wrapping is how the SDK adds context without
 * losing the status code, and classification needs that status to tell a `503`
 * (retry) from a `403` (fail fast).
 */
function chain(error: unknown, depth = 0): Record<string, unknown>[] {
  const record = asRecord(error);
  if (!record || depth > 3) return record ? [record] : [];
  const next = record.cause;
  if (next === undefined || next === error) return [record];
  return [record, ...chain(next, depth + 1)];
}

function readStatus(error: unknown): number | undefined {
  for (const record of chain(error)) {
    const response = asRecord(record.response);
    const fromResponse = response ? response.status : undefined;
    if (typeof fromResponse === 'number') return fromResponse;
    if (typeof record.status === 'number') return record.status;
  }
  return undefined;
}

function readHeader(error: unknown, name: string): unknown {
  for (const record of chain(error)) {
    const response = asRecord(record.response);
    const headers = response ? asRecord(response.headers) : undefined;
    const fromHeaders = headers?.[name];
    if (fromHeaders !== undefined) return fromHeaders;
    const fromCause = record[name];
    if (fromCause !== undefined) return fromCause;
  }
  return undefined;
}

/**
 * Parses a `Retry-After` header (delta-seconds or an HTTP-date) into ms.
 * Returns `undefined` for missing, malformed, negative or absurd values.
 */
export function parseRetryAfterMs(value: unknown, now: number = Date.now()): number | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/** Reads the `Retry-After` hint (ms) off an axios error, if present. */
export function readRetryAfterMs(error: unknown): number | undefined {
  const parsed = parseRetryAfterMs(readHeader(error, 'retry-after'));
  return parsed === undefined ? undefined : parsed;
}

/**
 * Marks an error as worth retrying (or explicitly not), overriding the
 * heuristic classification. Used by `TransactionPipeline`, which knows from
 * the RPC response whether the node accepted the transaction.
 */
export function markTransient<T>(error: T, transient = true): T {
  if (asRecord(error)) {
    Object.defineProperty(error, TRANSIENT_MARKER, {
      value: transient,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }
  return error;
}

/** True when {@link markTransient} has already ruled on this error. */
function explicitVerdict(error: unknown): boolean | undefined {
  const record = asRecord(error);
  if (!record) return undefined;
  const value = (record as Record<PropertyKey, unknown>)[TRANSIENT_MARKER];
  return typeof value === 'boolean' ? value : undefined;
}

/** Classification for one failure. Never throws. */
export function classifyFailure(error: unknown): TransientFailure {
  const explicit = explicitVerdict(error);
  if (explicit !== undefined) {
    return {
      kind: explicit ? 'unknown' : 'deterministic',
      transient: explicit,
      reason: explicit
        ? 'marked transient by the call site'
        : 'marked non-retryable by the call site',
    };
  }

  const status = readStatus(error);
  if (status !== undefined) {
    const retryAfterMs = readRetryAfterMs(error);
    if (status === 429) {
      return { kind: 'throttled', transient: true, status, retryAfterMs, reason: 'HTTP 429' };
    }
    if (status === 408) {
      return { kind: 'timeout', transient: true, status, retryAfterMs, reason: 'HTTP 408' };
    }
    if (status >= 500 && status < 600) {
      return { kind: 'server', transient: true, status, retryAfterMs, reason: `HTTP ${status}` };
    }
    return {
      kind: 'deterministic',
      transient: false,
      status,
      reason: `HTTP ${status} is a client error`,
    };
  }

  const record = asRecord(error);
  const code = record?.code;
  if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code.toUpperCase())) {
    const kind: TransientFailureKind =
      code.toUpperCase() === 'ETIMEDOUT' || code.toUpperCase() === 'ECONNABORTED'
        ? 'timeout'
        : 'network';
    return { kind, transient: true, reason: `${code} is a transport failure` };
  }

  const name = record?.name;
  if (name === 'TimeoutError') {
    return { kind: 'timeout', transient: true, reason: 'request timed out' };
  }
  if (name === 'AbortError') {
    return { kind: 'timeout', transient: true, reason: 'request was aborted' };
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (message) {
    const lower = message.toLowerCase();
    if (TRANSIENT_FETCH_MESSAGES.some((hint) => lower.includes(hint))) {
      return { kind: 'network', transient: true, reason: 'fetch failed at the transport layer' };
    }
    if (NODE_BUSY_PATTERN.test(message)) {
      return { kind: 'node-busy', transient: true, reason: 'node deferred the request' };
    }
  }

  // A `TrustFlowError` carries a stable, intentional code. Codes that describe
  // a deterministic rejection must not be retried; everything else is either
  // explicitly transient or opaque enough to be treated as one.
  const sdkCode = record && typeof record.code === 'string' ? record.code : undefined;
  if (sdkCode && record) {
    if (NON_RETRYABLE_SDK_CODES.has(sdkCode)) {
      return { kind: 'deterministic', transient: false, reason: `SDK error ${sdkCode}` };
    }
    if (RETRYABLE_SDK_CODES.has(sdkCode)) {
      return { kind: 'unknown', transient: true, reason: `SDK error ${sdkCode}` };
    }
    // `RETRY_EXHAUSTED` (and any future wrapping code) is re-classified from
    // the failure it wraps, so callers see why the inner attempt failed.
    if (record.cause !== undefined && record.cause !== error) {
      const inner = classifyFailure(record.cause);
      return { ...inner, reason: `${sdkCode} wrapping ${inner.reason}` };
    }
  }

  return {
    kind: 'unknown',
    transient: true,
    reason: 'unrecognised error treated as a transport failure',
  };
}

/** Convenience predicate over {@link classifyFailure}. */
export function isTransientError(error: unknown): boolean {
  return classifyFailure(error).transient;
}

const RETRYABLE_SDK_CODES = new Set([
  'CONNECTION_ERROR',
  'NETWORK_ERROR',
  'TIMEOUT',
  'BALANCE_FETCH_ERROR',
]);

const NON_RETRYABLE_SDK_CODES = new Set([
  'CONTRACT_ERROR',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'SIMULATION_ERROR',
  'SIGNING_ERROR',
  'INVALID_CONFIG',
  'NOT_CONNECTED',
  'MULTISIG_ERROR',
  'MULTISIG_THRESHOLD_NOT_MET',
  'MULTISIG_ALREADY_SIGNED',
  'MULTISIG_EXPIRED',
  'MULTISIG_INVALID_SIGNER',
  'MULTISIG_XDR_ERROR',
  'ASSEMBLY_ERROR',
  'FEE_BUMP_ERROR',
  'SUBMISSION_ERROR',
  'AUTH_ERROR',
  'INVALID_CONTRACT_CALL',
  'CIRCUIT_BREAKER_OPEN',
]);
