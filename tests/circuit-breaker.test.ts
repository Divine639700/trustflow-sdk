/**
 * Circuit breaker recovery tests (#353).
 *
 * The regression these cover: when every endpoint is down, a fallback that also
 * fails must not leave the circuit permanently OPEN with no path back. Recovery
 * after `resetTimeoutMs` is what makes the client self-healing instead of
 * requiring a manual `reset()`.
 */

import { CircuitBreaker, CircuitBreakerRegistry } from '../src/utils/circuit-breaker';

const config = {
  failureThreshold: 2,
  resetTimeoutMs: 1_000,
  successThreshold: 1,
};

const boom = async (): Promise<never> => {
  throw new Error('endpoint down');
};
const pong = async (): Promise<string> => 'pong';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens once the failure threshold is reached', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow('endpoint down');
    await expect(breaker.execute(boom)).rejects.toThrow('endpoint down');
    expect(breaker.getState()).toBe('OPEN');
  });

  it('fails fast while OPEN without calling the endpoint', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();

    let calls = 0;
    const counted = async () => {
      calls++;
      return 'pong';
    };

    await expect(breaker.execute(counted)).rejects.toThrow(/Circuit breaker is OPEN/);
    expect(calls).toBe(0);
  });

  // The core of #353: recovery must not depend on the failing path succeeding.
  it('transitions OPEN -> HALF_OPEN once the reset timeout elapses', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    expect(breaker.getState()).toBe('OPEN');

    jest.advanceTimersByTime(1_000);
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  it('recovers automatically when the endpoint becomes healthy again', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();

    jest.advanceTimersByTime(1_000);
    await expect(breaker.execute(pong)).resolves.toBe('pong');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('returns to OPEN and re-arms the timeout when the probe still fails', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();

    jest.advanceTimersByTime(1_000);
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Endpoint still down: the probe must re-open the circuit, not wedge it.
    await expect(breaker.execute(boom)).rejects.toThrow('endpoint down');
    expect(breaker.getState()).toBe('OPEN');

    // A second timeout is required before probing again.
    jest.advanceTimersByTime(500);
    expect(breaker.getState()).toBe('OPEN');
    jest.advanceTimersByTime(500);
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  it('does not flood a degraded endpoint while HALF_OPEN', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    jest.advanceTimersByTime(1_000);
    expect(breaker.getState()).toBe('HALF_OPEN');

    let calls = 0;
    let releaseProbe: () => void = () => {};
    // A probe that never settles on its own: the test releases it explicitly so
    // the other three callers observe a genuinely in-flight probe.
    const slow = async () => {
      calls++;
      await new Promise<void>((resolve) => {
        releaseProbe = resolve;
      });
      return 'pong';
    };

    const attempts = [
      breaker.execute(slow),
      breaker.execute(slow),
      breaker.execute(slow),
      breaker.execute(slow),
    ];

    // Let the four calls run up to the point where the first one is parked
    // inside the endpoint call.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    releaseProbe();
    const results = await Promise.allSettled(attempts);

    // Only the single permitted probe reaches the endpoint.
    expect(calls).toBe(1);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const failure of rejected) {
      expect((failure as PromiseRejectedResult).reason.message).toMatch(/already in flight/);
    }
  });

  it('allows a further probe after the in-flight one settles', async () => {
    const breaker = new CircuitBreaker({ ...config, successThreshold: 2 });
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    jest.advanceTimersByTime(1_000);
    expect(breaker.getState()).toBe('HALF_OPEN');

    await expect(breaker.execute(pong)).resolves.toBe('pong');
    expect(breaker.getDiagnostics().probeInFlight).toBe(false);
    // successThreshold is 2, so one probe leaves it half-open but usable again.
    expect(breaker.getState()).toBe('HALF_OPEN');
    await expect(breaker.execute(pong)).resolves.toBe('pong');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('closes only after successThreshold consecutive successful probes', async () => {
    const breaker = new CircuitBreaker({ ...config, successThreshold: 3 });
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    jest.advanceTimersByTime(1_000);

    await breaker.execute(pong);
    expect(breaker.getState()).toBe('HALF_OPEN');
    await breaker.execute(pong);
    expect(breaker.getState()).toBe('HALF_OPEN');
    await breaker.execute(pong);
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('resets the consecutive failure count on a successful probe', async () => {
    const breaker = new CircuitBreaker({ ...config, failureThreshold: 3 });
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    expect(breaker.getDiagnostics().failureCount).toBe(2);

    await breaker.execute(pong);
    expect(breaker.getDiagnostics().failureCount).toBe(0);
  });

  it('does not inherit a stale retry timestamp after recovering', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    jest.advanceTimersByTime(1_000);
    breaker.getState();
    // Entering HALF_OPEN must clear the expired deadline.
    expect(breaker.getDiagnostics().nextRetryTime).toBeUndefined();

    await breaker.execute(pong);
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getDiagnostics().nextRetryTime).toBeUndefined();
  });

  it('notifies on state transitions', async () => {
    const onStateChange = jest.fn();
    const breaker = new CircuitBreaker({ ...config, onStateChange });
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    jest.advanceTimersByTime(1_000);
    await breaker.execute(pong);

    expect(onStateChange).toHaveBeenCalledWith('CLOSED', 'OPEN');
    expect(onStateChange).toHaveBeenCalledWith('OPEN', 'HALF_OPEN');
    expect(onStateChange).toHaveBeenCalledWith('HALF_OPEN', 'CLOSED');
  });

  it('recovers through executeSync as well', () => {
    const breaker = new CircuitBreaker(config);
    const boomSync = (): never => {
      throw new Error('sync down');
    };
    expect(() => breaker.executeSync(boomSync)).toThrow('sync down');
    expect(() => breaker.executeSync(boomSync)).toThrow('sync down');
    expect(breaker.getState()).toBe('OPEN');

    jest.advanceTimersByTime(1_000);
    expect(breaker.getState()).toBe('HALF_OPEN');
    expect(breaker.executeSync(() => 'ok')).toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('manual reset returns a wedged circuit to CLOSED', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();
    expect(breaker.getState()).toBe('OPEN');

    breaker.reset();
    expect(breaker.getState()).toBe('CLOSED');
    await expect(breaker.execute(pong)).resolves.toBe('pong');
  });

  it('recovers without a manual reset, which is the point of the fix', async () => {
    const breaker = new CircuitBreaker(config);
    await expect(breaker.execute(boom)).rejects.toThrow();
    await expect(breaker.execute(boom)).rejects.toThrow();

    // Three outage/recovery cycles back to back.
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(1_000);
      await expect(breaker.execute(pong)).resolves.toBe('pong');
      expect(breaker.getState()).toBe('CLOSED');
      if (i < 2) {
        await expect(breaker.execute(boom)).rejects.toThrow();
        await expect(breaker.execute(boom)).rejects.toThrow();
      }
    }
  });
});

describe('CircuitBreakerRegistry', () => {
  it('reuses one breaker per service and recovers each independently', async () => {
    jest.useFakeTimers();
    const registry = new CircuitBreakerRegistry();
    const primary = registry.get('primary', config);
    const fallback = registry.get('fallback', config);

    expect(registry.get('primary')).toBe(primary);

    // Both endpoints are down, as in the reported scenario.
    await expect(primary.execute(boom)).rejects.toThrow();
    await expect(primary.execute(boom)).rejects.toThrow();
    await expect(fallback.execute(boom)).rejects.toThrow();
    await expect(fallback.execute(boom)).rejects.toThrow();
    expect(primary.getState()).toBe('OPEN');
    expect(fallback.getState()).toBe('OPEN');

    // The endpoint recovers; neither breaker needs a manual reset.
    jest.advanceTimersByTime(1_000);
    expect(primary.getState()).toBe('HALF_OPEN');
    expect(fallback.getState()).toBe('HALF_OPEN');
    await expect(primary.execute(pong)).resolves.toBe('pong');
    await expect(fallback.execute(pong)).resolves.toBe('pong');
    expect(primary.getState()).toBe('CLOSED');
    expect(fallback.getState()).toBe('CLOSED');

    registry.resetAll();
    expect(registry.getAll().size).toBe(2);
    jest.useRealTimers();
  });
});
