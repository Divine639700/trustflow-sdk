import { createApiHttpClient } from '../utils/http';
import type { ApiRetryConfig } from '../utils/http';
import type { HttpInterceptors } from '../utils/interceptors';
import { TrustFlowError } from '../errors';
import { logger } from '../utils/logger';
import { saveSession } from './session';

export interface AuthChallenge {
  challenge: string;
  expiresAt: number;
  address: string;
}

/**
 * Parses a JWT token and extracts the expiry timestamp from the `exp` claim.
 * Returns the expiry as a UNIX timestamp in milliseconds, or null if parsing fails.
 */
function parseJwtExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000; // Convert from seconds to milliseconds
    }
    return null;
  } catch {
    return null;
  }
}

export interface AuthRequestOptions {
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Retry budget for the auth call. Defaults to 3 retries with a 250ms base
   * delay and a 2s cap.
   *
   * `requestChallenge` is a `GET` and is retried on `429`/`5xx`/transport
   * errors. `verifyAndGetToken` is a `POST` and is **not** retried by default:
   * the backend may have issued a token before the response was lost, and a
   * replay would mint a second session. Signature-verification `4xx` always
   * fails fast — retrying a bad signature only wastes rate limit.
   */
  retry?: ApiRetryConfig;
  /** Request/response interceptor hooks applied to auth API calls. */
  interceptors?: HttpInterceptors;
}

/**
 * Requests a signing challenge from the TrustFlow backend.
 *
 * **Retry behaviour:** a `GET`, so transient failures (network error, timeout,
 * `429`, `5xx`) are retried with capped, jittered backoff, honouring
 * `Retry-After`. A `4xx` — unknown address, rate-limit-rejected signature —
 * fails immediately.
 */
export async function requestChallenge(
  apiUrl: string,
  address: string,
  options: AuthRequestOptions = {},
): Promise<AuthChallenge> {
  logger.debug('Requesting auth challenge', { address });
  const http = createApiHttpClient({
    baseURL: apiUrl,
    timeoutMs: options.timeoutMs,
    retry: options.retry,
    interceptors: options.interceptors,
  });
  try {
    const response = await http.get<{ challenge: string }>('/auth/challenge', {
      params: { address },
    });
    logger.debug('Auth challenge received', { address });
    return { challenge: response.data.challenge, expiresAt: Date.now() + 60_000, address };
  } catch (error) {
    logger.error('Failed to get auth challenge', { address, error });
    throw new TrustFlowError('Failed to get challenge', 'CONNECTION_ERROR', error);
  }
}

/**
 * Verifies a signature and exchanges it for a backend session token.
 *
 * **Retry behaviour:** a `POST`, so `429`/`5xx` and transport errors are not
 * replayed by default (a lost response may still have produced a token). Set
 * `trustflowRetry` on the underlying call, or rely on the client's idempotency
 * key, when replaying is safe. A rejected signature (`4xx`) always fails fast.
 */
export async function verifyAndGetToken(
  apiUrl: string,
  address: string,
  signature: string,
  options: AuthRequestOptions = {},
): Promise<string> {
  logger.debug('Verifying auth signature', { address });
  const http = createApiHttpClient({
    baseURL: apiUrl,
    timeoutMs: options.timeoutMs,
    retry: options.retry,
    interceptors: options.interceptors,
  });
  try {
    const response = await http.post<{ token: string }>('/auth/verify', { address, signature });
    logger.debug('Auth verification succeeded', { address });
    return response.data.token;
  } catch (error) {
    logger.error('Auth verification failed', { address, error });
    throw new TrustFlowError('Signature verification failed', 'UNAUTHORIZED', error);
  }
}

/**
 * Options for the complete authentication flow (excluding the signer, which is a separate parameter).
 */
export interface AuthFlowOptions extends AuthRequestOptions {
  /**
   * Optional scope for session storage (e.g., account ID for multi-account apps).
   */
  scope?: string;
}

/**
 * Complete authentication flow: request challenge, sign it, verify with backend, and persist session.
 *
 * This function handles the entire wallet authentication flow:
 * 1. Requests a signing challenge from the backend
 * 2. Validates the challenge hasn't expired (freshness check)
 * 3. Signs the challenge using the provided signer (wallet or keypair)
 * 4. Verifies the signature with the backend to get a JWT token
 * 5. Parses the JWT `exp` claim for accurate expiry (falls back to 15min default)
 * 6. Persists the session via `saveSession`
 *
 * @param apiUrl - Base URL of the TrustFlow backend API
 * @param address - Stellar public key (G...) of the signing account
 * @param signer - Wallet adapter (with `signMessage`) or Keypair (with `sign`)
 * @param options - Optional request options and session scope
 * @returns The authenticated session with token, address, and parsed expiry
 * @throws {TrustFlowError} `CONNECTION_ERROR` for network issues, `UNAUTHORIZED` for signature verification failure, `STALE_CHALLENGE` if challenge expired
 *
 * @example
 * ```typescript
 * // Browser with Freighter
 * const session = await authenticateWithWallet(apiUrl, address, { signMessage: (msg) => freighter.signMessage(msg) });
 *
 * // Node/CLI with Keypair
 * const session = await authenticateWithWallet(apiUrl, address, Keypair.fromSecret(secret));
 * ```
 */
export async function authenticateWithWallet(
  apiUrl: string,
  address: string,
  signer: { signMessage(message: string): Promise<string> } | { sign(message: Buffer): Buffer },
  options: AuthFlowOptions = {},
): Promise<{ token: string; address: string; expiresAt: number }> {
  logger.debug('Starting authentication flow', { address });

  // Step 1: Request challenge
  const challenge = await requestChallenge(apiUrl, address, options);

  // Step 2: Validate challenge freshness (backend nonce lives 60s, single-use)
  if (Date.now() >= challenge.expiresAt) {
    throw new TrustFlowError('Authentication challenge has expired', 'STALE_CHALLENGE');
  }

  // Step 3: Sign the challenge
  let signature: string;
  try {
    if ('signMessage' in signer) {
      // Wallet adapter (Freighter, Albedo, etc.)
      signature = await signer.signMessage(challenge.challenge);
    } else {
      // Raw Keypair (Node/CLI)
      const messageBytes = Buffer.from(challenge.challenge, 'utf-8');
      const sig = signer.sign(messageBytes);
      signature = sig.toString('base64');
    }
    logger.debug('Challenge signed', { address });
  } catch (error) {
    logger.error('Failed to sign challenge', { address, error });
    throw new TrustFlowError('Failed to sign challenge', 'SIGNING_ERROR', error);
  }

  // Step 4: Verify signature and get token
  const token = await verifyAndGetToken(apiUrl, address, signature, options);

  // Step 5: Parse JWT expiry from token (backend uses expiresIn: '24h')
  const expiresAt = parseJwtExpiry(token) ?? Date.now() + 15 * 60_000;

  // Step 6: Persist session
  saveSession(token, address, expiresAt, options.scope);

  logger.debug('Authentication flow completed', { address, expiresAt });

  return { token, address, expiresAt };
}