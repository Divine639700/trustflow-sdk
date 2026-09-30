import type { SDKResult } from '../types/index';
import type { Profile, UpdateProfileParams } from '../types/profile';
import { isValidStellarAddress } from '../utils/validation';
import { createApiHttpClient, toApiErrorMessage } from '../utils/http';
import type { ApiRetryConfig } from '../utils/http';
import type { HttpInterceptors } from '../utils/interceptors';

export interface ProfileClientOptions {
  /** Per-request timeout (ms) applied to backend profile calls. */
  timeoutMs?: number;
  /**
   * Retry budget for backend calls. Defaults to 3 retries with a 250ms base
   * delay and a 2s cap.
   *
   * Only transient failures are retried, and only for idempotent methods:
   * `getProfile` (`GET`) is retried, `updateProfile` (`PUT`, which is
   * idempotent) is retried, and neither is retried on `4xx`.
   */
  retry?: ApiRetryConfig;
  /** Request/response interceptor hooks applied to profile API calls. */
  interceptors?: HttpInterceptors;
}

/**
 * Type-safe Axios wrapper for the TrustFlow backend's `/profiles` endpoints.
 *
 * **Retry behaviour:** `getProfile` is a `GET` and `updateProfile` a `PUT`, both
 * idempotent, so `429`, `5xx` and transport errors are retried with capped,
 * jittered backoff (honouring `Retry-After`), while `4xx` fails immediately.
 *
 * @example
 * ```typescript
 * const profiles = new ProfileClient('https://api.trustflow.dev', token);
 * const result = await profiles.getProfile(wallet.publicKey);
 * if (result.ok) console.log(result.data.displayName);
 * ```
 */
export class ProfileClient {
  private readonly http;

  constructor(
    private apiUrl: string,
    private token: string,
    options: ProfileClientOptions = {},
  ) {
    this.http = createApiHttpClient({
      baseURL: this.apiUrl,
      timeoutMs: options.timeoutMs,
      retry: options.retry,
      interceptors: options.interceptors,
      additionalHeaders: {
        Authorization: `Bearer ${this.token}`,
      },
    });
  }

  /**
   * Fetches a user's profile from the backend API.
   *
   * Retries transient backend failures (network error, timeout, `429`, `5xx`)
   * with capped, jittered backoff before returning an error.
   */
  async getProfile(address: string): Promise<SDKResult<Profile>> {
    if (!isValidStellarAddress(address)) {
      return { ok: false, error: `Invalid Stellar address for "address": ${address}` };
    }
    try {
      const response = await this.http.get<Profile>(`/profiles/${address}`);
      return { ok: true, data: response.data };
    } catch (e) {
      return { ok: false, error: toApiErrorMessage(e) };
    }
  }

  /**
   * Updates a user's profile via the backend API.
   *
   * `PUT` is idempotent, so transient backend failures (network error, timeout,
   * `429`, `5xx`) are retried with capped, jittered backoff before returning an
   * error. `4xx` fails immediately.
   */
  async updateProfile(address: string, params: UpdateProfileParams): Promise<SDKResult<Profile>> {
    if (!isValidStellarAddress(address)) {
      return { ok: false, error: `Invalid Stellar address for "address": ${address}` };
    }
    try {
      const response = await this.http.put<Profile>(`/profiles/${address}`, params);
      return { ok: true, data: response.data };
    } catch (e) {
      return { ok: false, error: toApiErrorMessage(e) };
    }
  }
}
