import { createApiHttpClient } from '../utils/http';
import type { ApiRetryConfig } from '../utils/http';
import { TrustFlowError } from '../errors';
import { logger } from '../utils/logger';
import { saveSession, loadSession, type Session } from './session';

/**
 * Margin in milliseconds before the JWT `exp` timestamp at which the refresh
 * timer fires. A 60-second lead gives enough runway for a network round-trip
 * while keeping sessions alive without user-visible interruption.
 */
const REFRESH_LEAD_MS = 60_000;

/**
 * Minimum remaining token lifetime (ms) required to schedule a refresh timer.
 * If the token is already within this window when `start()` is called, a
 * refresh is triggered immediately instead of scheduling a timer that would
 * fire after expiry.
 */
const MIN_SCHEDULE_MARGIN_MS = 5_000;

/** Callback invoked when a session is silently refreshed or when refresh fails. */
export interface TokenRefreshListener {
  /** Called after a successful silent refresh with the new session. */
  onRefresh?(session: Session): void;
  /** Called when a silent refresh fails. */
  onRefreshError?(error: Error): void;
}

/** Configuration for the token refresh manager. */
export interface TokenRefreshConfig {
  /** Base URL of the TrustFlow backend API (e.g. `https://api.trustflow.xyz`). */
  apiUrl: string;
  /** Optional session scope (account id) for multi-account isolation. */
  scope?: string;
  /** Optional retry budget forwarded to the refresh HTTP call. */
  retry?: ApiRetryConfig;
  /** Optional listener for refresh lifecycle events. */
  listener?: TokenRefreshListener;
  /**
   * Override the default refresh lead time (ms before expiry). Primarily
   * useful for tests that need a shorter or longer margin.
   * @default 60_000
   */
  refreshLeadMs?: number;
}

/**
 * Decodes a JWT's payload and extracts the `exp` claim as a UNIX-ms timestamp.
 *
 * Uses only base64 decoding — no signature verification. Signature trust is
 * the backend's responsibility; this is a best-effort client-side hint for
 * scheduling the refresh timer.
 *
 * @returns UNIX-ms expiry, or `null` when the token is malformed / has no `exp`.
 */
export function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Handle both Node Buffer and browser atob environments.
    let json: string;
    if (typeof Buffer !== 'undefined') {
      json = Buffer.from(parts[1], 'base64').toString('utf-8');
    } else if (typeof atob === 'function') {
      json = atob(parts[1]);
    } else {
      return null;
    }

    const payload = JSON.parse(json);
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000; // seconds → ms
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Manages silent JWT access-token refresh before expiration.
 *
 * ## Design invariants
 *
 * 1. **Single-flight refresh**: concurrent callers that hit `waitForRefresh()`
 *    while a refresh is in-flight all share the same underlying HTTP call, so
 *    the backend receives at most one `POST /auth/refresh` per refresh cycle.
 *
 * 2. **Request queuing**: callers can `await waitForRefresh()` before issuing
 *    authenticated requests. When no refresh is in progress the await resolves
 *    immediately; when one is in flight it resolves once the new token lands.
 *
 * 3. **Timer lifecycle**: `start()` schedules (or immediately triggers) a
 *    refresh; `stop()` cancels the timer and drains any pending waiters.
 *    The manager is safe to start/stop repeatedly across session changes.
 *
 * 4. **Scope isolation**: a `scope` parameter isolates storage keys, matching
 *    the multi-account scoping in `session.ts`, so two signed-in accounts
 *    never interfere with each other's refresh timers.
 */
export class TokenRefreshManager {
  private readonly apiUrl: string;
  private readonly scope?: string;
  private readonly retry?: ApiRetryConfig;
  private readonly listener?: TokenRefreshListener;
  private readonly refreshLeadMs: number;

  /** Handle returned by `setTimeout`; `null` when no timer is pending. */
  private timerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * When a refresh is in-flight this promise resolves with the new session.
   * All concurrent callers share the same promise (single-flight).
   */
  private inflightRefresh: Promise<Session> | null = null;

  constructor(config: TokenRefreshConfig) {
    this.apiUrl = config.apiUrl;
    this.scope = config.scope;
    this.retry = config.retry;
    this.listener = config.listener;
    this.refreshLeadMs = config.refreshLeadMs ?? REFRESH_LEAD_MS;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Starts (or restarts) the silent-refresh timer based on the current stored
   * session's JWT expiry.
   *
   * If the token is already within the refresh margin, a refresh is triggered
   * immediately. If the session is missing or has no decodable `exp` claim, the
   * call is a no-op (nothing to schedule).
   */
  start(): void {
    this.stop();

    const session = loadSession(this.scope);
    if (!session) {
      logger.debug('TokenRefreshManager: no session — skipping start');
      return;
    }

    const expMs = decodeJwtExpMs(session.token);
    if (expMs === null) {
      logger.debug('TokenRefreshManager: token has no decodable exp — skipping');
      return;
    }

    const msUntilRefresh = expMs - Date.now() - this.refreshLeadMs;

    if (msUntilRefresh <= MIN_SCHEDULE_MARGIN_MS) {
      // Already inside (or past) the refresh window — fire immediately.
      logger.debug('TokenRefreshManager: token near expiry — refreshing now');
      this.performRefresh().catch(() => {
        // Error already reported via listener.onRefreshError — swallow here
        // to prevent unhandled promise rejection in fire-and-forget context.
      });
    } else {
      logger.debug('TokenRefreshManager: scheduling refresh', {
        inMs: msUntilRefresh,
      });
      this.timerId = setTimeout(() => {
        this.performRefresh().catch(() => {
          // Error already reported via listener.onRefreshError.
        });
      }, msUntilRefresh);
    }
  }

  /** Cancels any pending timer and abandons an in-flight refresh. */
  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.inflightRefresh = null;
  }

  /** `true` when a refresh HTTP call is currently in progress. */
  get isRefreshing(): boolean {
    return this.inflightRefresh !== null;
  }

  /**
   * Returns a promise that resolves when any in-flight refresh completes.
   *
   * Callers should `await` this before sending an authenticated request to
   * guarantee the request uses the freshest token. When no refresh is in
   * progress the promise resolves immediately with the current session.
   */
  async waitForRefresh(): Promise<Session | null> {
    if (this.inflightRefresh) {
      try {
        return await this.inflightRefresh;
      } catch {
        // Refresh failed — return whatever is in storage (possibly expired).
        return loadSession(this.scope);
      }
    }
    return loadSession(this.scope);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Executes a single-flight refresh: calls `POST /auth/refresh` with the
   * current token, persists the new token, and reschedules the next timer.
   */
  private async performRefresh(): Promise<Session> {
    // Single-flight: if a refresh is already in-flight, piggyback on it.
    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }

    this.inflightRefresh = this.doRefresh();

    try {
      const session = await this.inflightRefresh;
      return session;
    } finally {
      this.inflightRefresh = null;
    }
  }

  /**
   * The actual HTTP call + session persistence + re-schedule. Separated from
   * `performRefresh` so the single-flight guard stays clean.
   */
  private async doRefresh(): Promise<Session> {
    const currentSession = loadSession(this.scope);
    if (!currentSession) {
      throw new TrustFlowError('Cannot refresh: no active session', 'AUTH_ERROR');
    }

    logger.debug('TokenRefreshManager: calling POST /auth/refresh');

    const http = createApiHttpClient({
      baseURL: this.apiUrl,
      retry: this.retry,
    });

    try {
      const response = await http.post<{ token: string }>('/auth/refresh', undefined, {
        headers: {
          Authorization: `Bearer ${currentSession.token}`,
        },
      });

      const newToken = response.data.token;

      // Derive expiry from the new JWT, falling back to the default 15-min TTL.
      const newExpMs = decodeJwtExpMs(newToken) ?? Date.now() + 15 * 60_000;

      // Persist and reload.
      saveSession(newToken, currentSession.address, newExpMs, this.scope);
      const newSession = loadSession(this.scope)!;

      logger.debug('TokenRefreshManager: refresh succeeded', {
        expiresAt: newExpMs,
      });

      this.listener?.onRefresh?.(newSession);

      // Re-schedule the next refresh cycle.
      this.start();

      return newSession;
    } catch (error) {
      const wrapped =
        error instanceof TrustFlowError
          ? error
          : new TrustFlowError('Silent token refresh failed', 'AUTH_ERROR', error);

      logger.error('TokenRefreshManager: refresh failed', { error: wrapped });
      this.listener?.onRefreshError?.(wrapped);
      throw wrapped;
    }
  }
}
