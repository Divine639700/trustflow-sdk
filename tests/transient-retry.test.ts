import {
  classifyFailure,
  isTransientError,
  markTransient,
  parseRetryAfterMs,
  readRetryAfterMs,
} from '../src/utils/transient';
import { TrustFlowError } from '../src/errors';
import {
  DEFAULT_NODE_RETRY_CONFIG,
  resolveNodeRetryPolicy,
  withTransientRetry,
} from '../src/utils/node-retry';

describe('classifyFailure', () => {
  describe('HTTP status codes', () => {
    it.each([
      [429, 'throttled'],
      [408, 'timeout'],
      [500, 'server'],
      [502, 'server'],
      [503, 'server'],
      [599, 'server'],
    ])('treats %p as a transient %s failure', (status, kind) => {
      const failure = classifyFailure({ response: { status } });
      expect(failure.transient).toBe(true);
      expect(failure.kind).toBe(kind);
      expect(failure.status).toBe(status);
    });

    it.each([400, 401, 403, 404, 409, 422])('treats %p as deterministic', (status) => {
      const failure = classifyFailure({ response: { status } });
      expect(failure.transient).toBe(false);
      expect(failure.kind).toBe('deterministic');
    });

    it('reads the status off a wrapping TrustFlowError cause', () => {
      const wrapped = TrustFlowError.simulationFailed('upstream said no', {
        status: 503,
        'retry-after': '2',
      });
      const failure = classifyFailure(wrapped);
      expect(failure.transient).toBe(true);
      expect(failure.status).toBe(503);
      expect(failure.retryAfterMs).toBe(2000);
    });
  });

  describe('transport failures', () => {
    it.each([
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EHOSTUNREACH',
      'EPIPE',
      'ERR_NETWORK',
    ])('treats %s as a transient network failure', (code) => {
      const failure = classifyFailure(Object.assign(new Error('boom'), { code }));
      expect(failure.transient).toBe(true);
      expect(failure.kind).toBe('network');
    });

    it.each(['ETIMEDOUT', 'ECONNABORTED'])('treats %s as a transient timeout', (code) => {
      const failure = classifyFailure(Object.assign(new Error('slow'), { code }));
      expect(failure.transient).toBe(true);
      expect(failure.kind).toBe('timeout');
    });

    it.each(['failed to fetch', 'Load failed', 'Network request failed'])(
      'treats the fetch rejection "%s" as a transient network failure',
      (message) => {
        const failure = classifyFailure(new TypeError(message));
        expect(failure.transient).toBe(true);
        expect(failure.kind).toBe('network');
      },
    );

    it('treats a DOMException AbortError as a transient timeout', () => {
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      expect(classifyFailure(abort)).toMatchObject({ kind: 'timeout', transient: true });
    });

    it('treats an unrecognised plain error as transient', () => {
      const failure = classifyFailure(new Error('something went sideways'));
      expect(failure.transient).toBe(true);
      expect(failure.kind).toBe('unknown');
    });
  });

  describe('Soroban node deferrals', () => {
    it.each(['TRY_AGAIN_LATER', 'tx_too_early', 'ledger is busy', 'Too early'])(
      'treats "%s" as a retryable node deferral',
      (fragment) => {
        const failure = classifyFailure(
          TrustFlowError.submissionFailed(`node reported ${fragment}`),
        );
        expect(failure.transient).toBe(true);
        expect(failure.kind).toBe('node-busy');
      },
    );

    it('does not treat an on-chain FAILED result as transient', () => {
      const failure = classifyFailure(
        TrustFlowError.submissionFailed('transaction abc failed on-chain'),
      );
      expect(failure.transient).toBe(false);
      expect(failure.kind).toBe('deterministic');
    });

    it('does not treat a node ERROR rejection as transient', () => {
      const failure = classifyFailure(
        TrustFlowError.submissionFailed('node rejected transaction (abc)'),
      );
      expect(failure.transient).toBe(false);
    });
  });

  describe('TrustFlowError codes', () => {
    it.each([
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'NOT_FOUND',
      'SIMULATION_ERROR',
      'SIGNING_ERROR',
      'INVALID_CONFIG',
      'ASSEMBLY_ERROR',
      'FEE_BUMP_ERROR',
      'SUBMISSION_ERROR',
      'INVALID_CONTRACT_CALL',
    ])('never retries %s', (code) => {
      const error = new TrustFlowError('nope', code as never);
      expect(isTransientError(error)).toBe(false);
    });

    it.each(['CONNECTION_ERROR', 'NETWORK_ERROR', 'TIMEOUT'])('retries %s', (code) => {
      const error = new TrustFlowError('flaky', code as never);
      expect(isTransientError(error)).toBe(true);
    });

    it('re-classifies a RETRY_EXHAUSTED wrapper from the failure it wraps', () => {
      const exhaustedTransient = TrustFlowError.retryExhausted('prepare', 3, new Error('rpc down'));
      expect(isTransientError(exhaustedTransient)).toBe(true);

      const exhaustedTerminal = TrustFlowError.retryExhausted(
        'prepare',
        3,
        new TrustFlowError('Error(Contract, #1)', 'SIMULATION_ERROR'),
      );
      expect(isTransientError(exhaustedTerminal)).toBe(false);
    });
  });

  describe('explicit markers', () => {
    it('honours markTransient(true)', () => {
      const error = markTransient(new Error('try me again'));
      expect(isTransientError(error)).toBe(true);
    });

    it('honours markTransient(false) even for a network-looking error', () => {
      const error = markTransient(Object.assign(new Error('reset'), { code: 'ECONNRESET' }), false);
      expect(isTransientError(error)).toBe(false);
    });

    it('is a no-op for primitives', () => {
      expect(markTransient('nope')).toBe('nope');
      expect(classifyFailure(undefined).transient).toBe(true);
      expect(classifyFailure(null).transient).toBe(true);
    });
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs(1.5)).toBe(1500);
  });

  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000);
  });

  it('clamps a past date to zero rather than a negative delay', () => {
    const now = Date.parse('2026-01-01T00:01:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0);
  });

  it.each([undefined, null, '', '   ', 'soon', -5, NaN])('returns undefined for %p', (value) => {
    expect(parseRetryAfterMs(value)).toBeUndefined();
  });
});

describe('readRetryAfterMs', () => {
  it('reads a numeric or string header off an axios error', () => {
    expect(readRetryAfterMs({ response: { headers: { 'retry-after': 2 } } })).toBe(2000);
    expect(readRetryAfterMs({ response: { headers: { 'retry-after': '2' } } })).toBe(2000);
  });

  it('returns undefined when absent or malformed', () => {
    expect(readRetryAfterMs({ response: { headers: {} } })).toBeUndefined();
    expect(readRetryAfterMs({ response: { headers: { 'retry-after': 'nope' } } })).toBeUndefined();
    expect(readRetryAfterMs(new Error('no response'))).toBeUndefined();
  });
});

describe('resolveNodeRetryPolicy', () => {
  it('converts ApiRetryConfig.retries (extra attempts) into total attempts', () => {
    expect(resolveNodeRetryPolicy({ retries: 0 }).attempts).toBe(1);
    expect(resolveNodeRetryPolicy({ retries: 4 }).attempts).toBe(5);
  });

  it('falls back to the SDK default budget', () => {
    const policy = resolveNodeRetryPolicy(undefined);
    expect(policy.attempts).toBe(DEFAULT_NODE_RETRY_CONFIG.retries + 1);
    expect(policy.baseDelayMs).toBe(DEFAULT_NODE_RETRY_CONFIG.retryDelayMs);
    expect(policy.maxDelayMs).toBe(DEFAULT_NODE_RETRY_CONFIG.maxRetryDelayMs);
  });

  it('ignores an out-of-range retries value and falls back to the default', () => {
    expect(resolveNodeRetryPolicy({ retries: -5 }).attempts).toBe(
      DEFAULT_NODE_RETRY_CONFIG.retries + 1,
    );
    expect(resolveNodeRetryPolicy({ retries: 1.5 }).attempts).toBe(
      DEFAULT_NODE_RETRY_CONFIG.retries + 1,
    );
  });

  it('resolves to exactly one attempt when retries is zero', () => {
    expect(resolveNodeRetryPolicy({ retries: 0 }).attempts).toBe(1);
  });
});

describe('withTransientRetry', () => {
  it('resolves on the first successful attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withTransientRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce('recovered');

    await expect(
      withTransientRetry(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 }),
    ).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 and then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce('recovered');

    await expect(
      withTransientRetry(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 }),
    ).resolves.toBe('recovered');
  });

  it('fails fast on a 4xx without spending the remaining attempts', async () => {
    const failure = { response: { status: 404 } };
    const fn = jest.fn().mockRejectedValue(failure);

    await expect(
      withTransientRetry(fn, { attempts: 5, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toBe(failure);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails fast on a simulation error', async () => {
    const simulation = new TrustFlowError('Error(Contract, #7)', 'SIMULATION_ERROR');
    const fn = jest.fn().mockRejectedValue(simulation);

    await expect(
      withTransientRetry(fn, { attempts: 4, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toBe(simulation);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last failure once the budget is spent', async () => {
    const last = Object.assign(new Error('still down'), { code: 'ECONNRESET' });
    const fn = jest.fn().mockRejectedValue(last);

    await expect(
      withTransientRetry(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honours the ApiRetryConfig budget passed from the client', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('down'));

    await expect(
      withTransientRetry(fn, undefined, { retries: 1, retryDelayMs: 1, maxRetryDelayMs: 1 }),
    ).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('prefers a Retry-After hint over its own backoff schedule', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce({
        response: { status: 429, headers: { 'retry-after': '0' } },
      })
      .mockResolvedValueOnce('after-wait');

    // A 50s base delay would make this test hang if Retry-After were ignored.
    await expect(
      withTransientRetry(fn, { attempts: 2, baseDelayMs: 50_000, maxDelayMs: 50_000 }),
    ).resolves.toBe('after-wait');
  });
});
