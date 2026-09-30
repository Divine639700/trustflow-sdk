import { retry as runRetry, backoffHonouringRetryAfter } from './retry';
import { isTransientError } from './transient';
import type { ApiRetryConfig } from './http';
import { withTimeout } from './timeout';
import { logger } from './logger';

/**
 * Default retry budget for Horizon / Soroban RPC / raw-`fetch` calls.
 *
 * These calls bypass `createApiHttpClient` (they speak the Stellar SDK's own
 * Horizon/RPC transports or global `fetch`), so they are wired to this budget
 * instead of `ApiRetryConfig`'s defaults. Kept deliberately short so a
 * degraded network surfaces quickly instead of stalling a UI.
 */
export const DEFAULT_NODE_RETRY_CONFIG: Required<
  Pick<ApiRetryConfig, 'retries' | 'retryDelayMs' | 'maxRetryDelayMs'>
> = {
  retries: 2,
  retryDelayMs: 300,
  maxRetryDelayMs: 5_000,
};

/**
 * Normalises a partial {@link ApiRetryConfig} into the concrete numbers
 * {@link withTransientRetry} needs, filling in {@link DEFAULT_NODE_RETRY_CONFIG}.
 */
export interface ResolvedNodeRetryPolicy {
  /** Total attempts, including the first. Always `>= 1`. */
  attempts: number;
  /** Delay before the second attempt. */
  baseDelayMs: number;
  /** Upper bound applied to any single delay. */
  maxDelayMs: number;
}

/**
 * `ApiRetryConfig` counts *extra* attempts (`retries: 3` means up to 4 calls),
 * matching `axios-retry`. `RetryPolicy.maxAttempts` counts total attempts. This
 * converts between the two so `ClientConfig.retry` can reuse the existing
 * `ApiRetryConfig` shape instead of introducing a third.
 */
export function resolveNodeRetryPolicy(
  retry?: ApiRetryConfig,
  fallback: ResolvedNodeRetryPolicy = {
    attempts: DEFAULT_NODE_RETRY_CONFIG.retries + 1,
    baseDelayMs: DEFAULT_NODE_RETRY_CONFIG.retryDelayMs,
    maxDelayMs: DEFAULT_NODE_RETRY_CONFIG.maxRetryDelayMs,
  },
): ResolvedNodeRetryPolicy {
  const retries = retry?.retries;
  const attempts =
    Number.isInteger(retries) && (retries as number) >= 0
      ? (retries as number) + 1
      : fallback.attempts;
  return {
    attempts: Math.max(1, attempts),
    baseDelayMs: retry?.retryDelayMs ?? fallback.baseDelayMs,
    maxDelayMs: retry?.maxRetryDelayMs ?? fallback.maxDelayMs,
  };
}

/**
 * Runs `fn` with capped exponential backoff, jitter, and `Retry-After`
 * support, retrying **only transient failures**.
 *
 * Retried: transport errors, timeouts, `429`, `5xx`, and Soroban
 * `TRY_AGAIN_LATER`/`tx_too_early` deferrals.
 * Not retried: every other `4xx`, simulation errors, node `ERROR` rejections
 * and on-chain `FAILED` results — replaying those cannot change the outcome.
 *
 * This is the single retry primitive behind every Horizon read, Soroban RPC
 * call and raw-`fetch` helper in the SDK, so the policy in
 * `docs/spikes/issue-79-retry-session-multisig.md` §2 is applied uniformly.
 *
 * @param fn - Operation to run; receives the 1-indexed attempt number
 * @param options - Per-call overrides, merged over `retryConfig`. `timeoutMs`
 *   bounds **each attempt** (not the whole retry loop) and rejects with a
 *   `TIMEOUT` {@link TrustFlowError} when it elapses; a timed-out attempt is
 *   retried like any other transient failure.
 * @param retryConfig - `ApiRetryConfig` from `ClientConfig` / the sub-client options
 * @param label - Stage name used in retry log lines
 * @returns Whatever `fn` resolves to
 * @throws The final error, unchanged
 *
 * @example
 * ```typescript
 * const account = await withTransientRetry(
 *   () => server.getAccount(address),
 *   undefined,
 *   client.retryConfig,
 *   'rpc.getAccount',
 * );
 * ```
 */
export async function withTransientRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: Partial<ResolvedNodeRetryPolicy> & { timeoutMs?: number },
  retryConfig?: ApiRetryConfig,
  label?: string,
): Promise<T> {
  const resolved = resolveNodeRetryPolicy(retryConfig);
  const policy: ResolvedNodeRetryPolicy = {
    attempts: options?.attempts ?? resolved.attempts,
    baseDelayMs: options?.baseDelayMs ?? resolved.baseDelayMs,
    maxDelayMs: options?.maxDelayMs ?? resolved.maxDelayMs,
  };
  const timeoutMs = options?.timeoutMs;

  return runRetry(
    async (attempt: number) => withTimeout(fn(attempt), timeoutMs, label),
    {
      attempts: policy.attempts,
      delayMs: backoffHonouringRetryAfter(policy.baseDelayMs, policy.maxDelayMs),
      shouldRetry: isTransientError,
      jitter: true,
      onRetry: (attempt: number, error: unknown, info: { willRetry: boolean }) => {
        if (!info.willRetry) return;
        const reason = error instanceof Error ? error.message : String(error);
        logger.debug(
          `retrying ${label ?? 'request'} after transient failure (attempt ${attempt}): ${reason}`,
        );
      },
    },
  );
}
