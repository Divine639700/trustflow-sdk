/**
 * Circuit breaker pattern implementation for external service failures.
 * Prevents cascading failures by failing fast when services are degraded.
 */

import { TrustFlowError } from '../errors';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit. Defaults to 5. */
  failureThreshold?: number;
  /** Time in milliseconds before attempting to recover. Defaults to 30000. */
  resetTimeoutMs?: number;
  /** Number of successful calls needed to close circuit from HALF_OPEN. Defaults to 2. */
  successThreshold?: number;
  /** Optional callback when state changes. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  /** Optional callback when circuit opens. */
  onOpen?: (reason: string) => void;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;
  private nextRetryTime?: number;
  /**
   * Whether a HALF_OPEN health probe is currently in flight.
   *
   * HALF_OPEN exists to re-test a recovered endpoint with a *single* request.
   * Without this gate every concurrent caller would pass the `HALF_OPEN` check
   * at once and hammer an endpoint that is still degraded - the precise
   * failure mode the breaker exists to prevent.
   */
  private probeInFlight = false;

  readonly config: Required<CircuitBreakerConfig>;

  constructor(config?: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30_000,
      successThreshold: config?.successThreshold ?? 2,
      onStateChange: config?.onStateChange ?? (() => {}),
      onOpen: config?.onOpen ?? (() => {}),
    };
  }

  /**
   * Gets the current circuit state.
   */
  getState(): CircuitState {
    if (this.state === 'OPEN') {
      if (this.nextRetryTime && Date.now() >= this.nextRetryTime) {
        this.setState('HALF_OPEN');
      }
    }
    return this.state;
  }

  /**
   * Executes a function with circuit breaker protection.
   * Fails fast if circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === 'OPEN') {
      throw new TrustFlowError(
        'Circuit breaker is OPEN. Service unavailable. Retrying after timeout.',
        'NETWORK_ERROR',
      );
    }

    // Only one health probe may be in flight at a time; concurrent callers
    // fail fast rather than joining the probe.
    if (state === 'HALF_OPEN' && this.probeInFlight) {
      throw new TrustFlowError(
        'Circuit breaker is HALF_OPEN and a health probe is already in flight.',
        'NETWORK_ERROR',
      );
    }

    const isProbe = state === 'HALF_OPEN';
    if (isProbe) this.probeInFlight = true;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    } finally {
      // Release the probe slot even if `fn` throws, so a failed probe cannot
      // wedge the circuit in a permanently blocked HALF_OPEN state.
      if (isProbe) this.probeInFlight = false;
    }
  }

  /**
   * Synchronous variant of execute for non-async functions.
   */
  executeSync<T>(fn: () => T): T {
    const state = this.getState();

    if (state === 'OPEN') {
      throw new TrustFlowError(
        'Circuit breaker is OPEN. Service unavailable. Retrying after timeout.',
        'NETWORK_ERROR',
      );
    }

    try {
      const result = fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Records a successful call.
   */
  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.setState('CLOSED');
        this.successCount = 0;
      }
    } else if (this.state === 'CLOSED') {
      this.successCount = 0;
    }
  }

  /**
   * Records a failed call.
   */
  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === 'HALF_OPEN') {
      this.setState('OPEN');
    } else if (this.state === 'CLOSED' && this.failureCount >= this.config.failureThreshold) {
      this.setState('OPEN');
    }
  }

  /**
   * Transitions to a new state.
   */
  private setState(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === 'OPEN') {
      this.nextRetryTime = Date.now() + this.config.resetTimeoutMs;
      // A new OPEN cycle starts with no credit from earlier successes,
      // otherwise a later HALF_OPEN could close on fewer than
      // `successThreshold` consecutive probes.
      this.successCount = 0;
      this.probeInFlight = false;
      this.config.onOpen(`Circuit opened after ${this.failureCount} failures`);
    }

    if (newState === 'HALF_OPEN') {
      // The retry deadline has been consumed; clearing it keeps diagnostics
      // honest and stops the stale timestamp being re-tested.
      this.nextRetryTime = undefined;
      // Probes must earn the full success threshold on this attempt.
      this.successCount = 0;
      this.probeInFlight = false;
    }

    if (oldState !== newState) {
      this.config.onStateChange(oldState, newState);
    }
  }

  /**
   * Manually resets the circuit to CLOSED state.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    this.nextRetryTime = undefined;
    this.probeInFlight = false;
  }

  /**
   * Gets diagnostic information about the circuit.
   */
  getDiagnostics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextRetryTime: this.nextRetryTime,
      config: this.config,
    };
  }
}

/**
 * Creates a circuit breaker factory for managing multiple services.
 */
export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  /**
   * Gets or creates a circuit breaker for a service.
   */
  get(serviceName: string, config?: CircuitBreakerConfig): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(serviceName, new CircuitBreaker(config));
    }
    return this.breakers.get(serviceName)!;
  }

  /**
   * Removes a circuit breaker.
   */
  remove(serviceName: string): void {
    this.breakers.delete(serviceName);
  }

  /**
   * Gets all registered circuit breakers.
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Resets all circuit breakers.
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Gets diagnostic info for all breakers.
   */
  getDiagnostics() {
    const result: Record<string, any> = {};
    for (const [name, breaker] of this.breakers) {
      result[name] = breaker.getDiagnostics();
    }
    return result;
  }
}

/**
 * Global circuit breaker registry instance.
 */
export const globalCircuitBreakerRegistry = new CircuitBreakerRegistry();
