import type { AxiosError } from 'axios';
import { TrustFlowError } from '../errors';

/**
 * Default per-request timeout for Horizon / Soroban RPC calls, in
 * milliseconds. Matches the backend API client's default
 * ({@link import('./http').ApiHttpClientOptions.timeoutMs}) so every network
 * path in the SDK stalls for the same amount of time before surfacing a
 * `TIMEOUT` error.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Matches axios' timeout message, e.g. `timeout of 10000ms exceeded`. */
const AXIOS_TIMEOUT_PATTERN = /^timeout of (\d+)ms exceeded$/;

/**
 * True when the error is axios' request-timeout rejection: an `ECONNABORTED`
 * code plus the `timeout of <n>ms exceeded` message. Distinct from a transport
 * failure (connection refused, DNS, reset), which never carried a timeout
 * budget in the first place.
 */
export function isAxiosTimeoutError(error: unknown): error is AxiosError {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== 'ECONNABORTED') return false;
  return AXIOS_TIMEOUT_PATTERN.test(error.message);
}

/**
 * Extracts the configured timeout (ms) off an axios timeout error message.
 * Returns `undefined` for anything that is not an axios timeout rejection
 * (see {@link isAxiosTimeoutError}).
 */
export function axiosTimeoutMs(error: unknown): number | undefined {
  if (!isAxiosTimeoutError(error)) return undefined;
  const match = AXIOS_TIMEOUT_PATTERN.exec(error.message);
  if (!match) return undefined;
  const ms = Number(match[1]);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Races `promise` against a deadline, settling with whichever finishes first.
 *
 * When the deadline wins, the promise is rejected with a `TIMEOUT`
 * {@link TrustFlowError} naming `context` (when given). The underlying
 * operation is not cancelled — the caller decides whether the work is
 * abortable — but the caller stops waiting for it, which is what bounds a
 * stalled UI or queue. A `timeoutMs` of `undefined` returns the promise
 * unchanged, so callers can pass a straight-through config value.
 *
 * @param promise - The operation to bound
 * @param timeoutMs - Deadline in milliseconds; `undefined` disables the race
 * @param context - Operation name used in the timeout error message
 * @throws {TrustFlowError} `TIMEOUT` once `timeoutMs` elapses
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  context?: string,
): Promise<T> {
  if (timeoutMs === undefined) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(TrustFlowError.timedOut(timeoutMs, context)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * `fetch` with a deadline: aborts the request once `timeoutMs` elapses and
 * rejects with a `TIMEOUT` {@link TrustFlowError} instead of leaving the
 * caller hanging on a stalled socket.
 *
 * The abort is what distinguishes this from {@link withTimeout}: the in-flight
 * HTTP request is actually cancelled, so it stops consuming connection and
 * bandwidth budget rather than merely being ignored.
 *
 * @param url - Request URL, forwarded to `fetch`
 * @param init - Request init, forwarded with the abort `signal` attached
 * @param timeoutMs - Deadline in milliseconds; `undefined` calls plain `fetch`
 * @param context - Operation name used in the timeout error message
 * @throws {TrustFlowError} `TIMEOUT` once `timeoutMs` elapses
 */
export async function fetchWithTimeout(
  url: string,
  init: Parameters<typeof fetch>[1] | undefined,
  timeoutMs: number | undefined,
  context?: string,
): Promise<Response> {
  if (timeoutMs === undefined) {
    // Pass `init` through only when the caller actually supplied one, so a
    // bare `fetch(url)` call site stays a single-argument call.
    return init === undefined ? fetch(url) : fetch(url, init);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (timedOut) {
      throw TrustFlowError.timedOut(timeoutMs, context);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
