import { TrustFlowError } from '../errors';
import { readRetryAfterMs } from './transient';

export type DelayStrategy = number | ((attempt: number, error?: unknown) => number);

export interface RetryOptions {
  /** Maximum number of execution attempts. Must be a finite integer >= 1. */
  attempts: number;
  /**
   * Delay between attempts. A number is a base delay in ms (finite, >= 0) that scales
   * linearly with the attempt number (`delayMs * attempt`); a function receives the
   * 1-indexed attempt number (and, when the attempt has just failed, the error that
   * caused it) and returns the delay in ms — which is how the SDK's own retry
   * wrapper lets a `Retry-After` header win over its backoff schedule.
   */
  delayMs?: DelayStrategy;
  /**
   * Decides whether a given failure is worth another attempt. Receives the
   * 1-indexed attempt that just failed and the error it threw. Return `false`
   * to fail immediately with that error — the loop stops and the error
   * propagates unchanged (it is not wrapped in a retry-exhausted error).
   *
   * Defaults to retrying every failure, which preserves the behaviour of
   * callers that predate this option. Use
   * {@link import('./transient').isTransientError} for the SDK-wide policy:
   * network errors, timeouts, `429`/`5xx` and node-deferred work are retried,
   * while `4xx`, simulation errors, node rejections and on-chain failures are
   * not.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /**
   * Randomises each computed delay to avoid synchronised retries when many
   * callers fail at once. `true` uses "equal jitter": half the computed delay
   * plus a uniform random share of the other half, so the delay always stays
   * within `[delayMs / 2, delayMs]`. A number in `(0, 1]` applies that
   * fraction of the computed delay as random headroom instead
   * (`delayMs * (1 - factor) + random * delayMs * factor`). Defaults to
   * `false`, so delays remain exactly what `delayMs` computes.
   */
  jitter?: boolean | number;
  /**
   * Optional callback invoked after every failed attempt, including the last one.
   * `info.willRetry` is `false` when no further attempt follows, and `info.delayMs` is the
   * delay before the next attempt (`0` when none follows). Errors thrown by the callback are
   * swallowed and never replace the operation's error or stop the loop.
   */
  onRetry?: OnRetryCallback;
}

export interface RetryInfo {
  /** Whether another attempt will be made after this failure */
  willRetry: boolean;
  /** Delay in ms before the next attempt (0 when no attempt follows) */
  delayMs: number;
}

export type OnRetryCallback = (attempt: number, error: unknown, info: RetryInfo) => void;

function assertValidDelay(d: DelayStrategy): void {
  if (typeof d === 'number' && (!Number.isFinite(d) || d < 0)) {
    throw TrustFlowError.validation('delayMs', 'must be a finite number >= 0');
  }
}

/** Keeps jitter inside `[base * (1 - factor), base]`, never exceeding `base`. */
function applyJitter(delay: number, jitter: boolean | number): number {
  if (delay <= 0) return 0;
  const factor = jitter === true ? 0.5 : jitter;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return delay;
  const bounded = Math.min(factor, 1);
  const floor = delay * (1 - bounded);
  return Math.round(floor + Math.random() * (delay - floor));
}

/**
 * Generic retry helper with customizable backoff strategies, retry
 * classification, jitter, and per-attempt callbacks.
 *
 * By default every failure is retried (`shouldRetry` omitted). Pass
 * `shouldRetry: isTransientError` to retry only transport-level failures and
 * fail fast on deterministic rejections.
 *
 * @param fn Function to execute, receiving the current 1-indexed attempt number
 * @param attemptsOrOptions Total attempts (number) or a `RetryOptions` configuration object
 * @param delayMs Optional delay in ms (number for linear scaling) or a delay strategy function
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  attemptsOrOptions: number | RetryOptions,
  delayMs?: DelayStrategy,
): Promise<T> {
  let attempts: number;
  let delayStrategy: (attempt: number, error?: unknown) => number;
  let shouldRetry: ((error: unknown, attempt: number) => boolean) | undefined;
  let jitter: boolean | number | undefined;
  let onRetry: OnRetryCallback | undefined;

  if (typeof attemptsOrOptions === 'object') {
    attempts = attemptsOrOptions.attempts;
    const d = attemptsOrOptions.delayMs ?? 0;
    assertValidDelay(d);
    delayStrategy =
      typeof d === 'function'
        ? (attempt: number, error?: unknown) => d(attempt, error)
        : (attempt: number) => d * attempt;
    shouldRetry = attemptsOrOptions.shouldRetry;
    jitter = attemptsOrOptions.jitter;
    onRetry = attemptsOrOptions.onRetry;
  } else {
    attempts = attemptsOrOptions;
    const d = delayMs ?? 0;
    assertValidDelay(d);
    delayStrategy =
      typeof d === 'function'
        ? (attempt: number, error?: unknown) => d(attempt, error)
        : (attempt: number) => d * attempt;
  }

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw TrustFlowError.validation('attempts', 'must be a finite integer >= 1');
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const retryable = shouldRetry ? shouldRetry(e, attempt) : true;
      const willRetry = retryable && attempt < attempts;
      const delay = willRetry ? applyJitter(delayStrategy(attempt, e), jitter ?? false) : 0;
      if (onRetry) {
        try {
          onRetry(attempt, e, { willRetry, delayMs: delay });
        } catch {
          // A failing observer must not hide the operation's error or stop the loop.
        }
      }
      if (willRetry) {
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
      } else if (!retryable) {
        // The call site ruled this failure non-retryable: surface it as-is
        // rather than burning the remaining attempts on a guaranteed repeat.
        throw e;
      }
    }
  }

  throw lastErr ?? new TrustFlowError('Retry failed', 'RETRY_EXHAUSTED');
}

/**
 * Backoff used by every retried Horizon / Soroban RPC call in the SDK:
 * exponential and capped. Jitter is applied by {@link retry} itself (see
 * {@link RetryOptions.jitter}), so this returns the un-jittered schedule.
 *
 * @param baseDelayMs - Delay before the second attempt
 * @param maxDelayMs - Upper bound applied to any single delay
 * @returns A delay strategy compatible with {@link RetryOptions.delayMs}
 */
export function cappedExponentialBackoff(
  baseDelayMs: number,
  maxDelayMs: number,
): (attempt: number) => number {
  return (attempt: number) => Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
}

/**
 * Builds the delay strategy for an HTTP-facing retry: the server's
 * `Retry-After` hint wins when one was sent (still capped by `maxDelayMs`),
 * otherwise the exponential schedule applies.
 */
export function backoffHonouringRetryAfter(
  baseDelayMs: number,
  maxDelayMs: number,
): (attempt: number, error?: unknown) => number {
  const exponential = cappedExponentialBackoff(baseDelayMs, maxDelayMs);
  return (attempt: number, error?: unknown) => {
    const hint = readRetryAfterMs(error);
    return hint === undefined ? exponential(attempt) : Math.min(hint, maxDelayMs);
  };
}
