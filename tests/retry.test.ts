import { backoffHonouringRetryAfter, cappedExponentialBackoff, retry } from '../src/utils/retry';
import { isTransientError } from '../src/utils/transient';
import { TrustFlowError } from '../src/errors';

describe('cappedExponentialBackoff', () => {
  it('doubles the base delay per attempt', () => {
    const schedule = cappedExponentialBackoff(100, 10_000);
    expect(schedule(1)).toBe(100);
    expect(schedule(2)).toBe(200);
    expect(schedule(3)).toBe(400);
    expect(schedule(4)).toBe(800);
  });

  it('caps at maxDelayMs instead of growing without bound', () => {
    const schedule = cappedExponentialBackoff(100, 250);
    expect(schedule(1)).toBe(100);
    expect(schedule(2)).toBe(200);
    expect(schedule(3)).toBe(250);
    expect(schedule(10)).toBe(250);
  });
});

describe('backoffHonouringRetryAfter', () => {
  it('uses the exponential schedule when the error carries no hint', () => {
    const schedule = backoffHonouringRetryAfter(100, 10_000);
    expect(schedule(1)).toBe(100);
    expect(schedule(2, new Error('no header'))).toBe(200);
  });

  it('prefers a Retry-After hint over the schedule', () => {
    const schedule = backoffHonouringRetryAfter(100, 10_000);
    const throttled = { response: { status: 429, headers: { 'retry-after': '2' } } };
    expect(schedule(1, throttled)).toBe(2000);
  });

  it('still bounds a Retry-After hint by maxDelayMs', () => {
    const schedule = backoffHonouringRetryAfter(100, 250);
    const throttled = { response: { status: 503, headers: { 'retry-after': '60' } } };
    expect(schedule(1, throttled)).toBe(250);
  });
});

describe('retry shouldRetry and jitter', () => {
  /**
   * Samples the delays `retry` would actually schedule, without sleeping: the
   * `onRetry` observer reports the computed delay, and fake timers let the
   * `setTimeout` drain immediately.
   */
  async function collectJitteredDelays(options: {
    jitter: boolean | number;
    count: number;
  }): Promise<number[]> {
    const delays: number[] = [];
    jest.useFakeTimers();
    try {
      for (let i = 0; i < options.count; i++) {
        const fn = jest.fn().mockRejectedValue(new Error('x'));
        const settled = retry(fn, {
          attempts: 2,
          delayMs: () => 100,
          jitter: options.jitter,
          onRetry: (_a, _e, info) => {
            if (info.willRetry) delays.push(info.delayMs);
          },
        }).catch(() => undefined);
        await jest.advanceTimersByTimeAsync(1_000);
        await settled;
      }
    } finally {
      jest.useRealTimers();
    }
    return delays;
  }

  it('retries every failure by default, preserving pre-existing behaviour', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always'));
    await expect(retry(fn, { attempts: 3, delayMs: 1 })).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops immediately and rethrows unchanged when shouldRetry says no', async () => {
    const terminal = new Error('deterministic');
    const fn = jest.fn().mockRejectedValue(terminal);

    await expect(retry(fn, { attempts: 5, delayMs: 1, shouldRetry: () => false })).rejects.toBe(
      terminal,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes the 1-indexed attempt number to shouldRetry', async () => {
    const seen: number[] = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('one'))
      .mockRejectedValueOnce(new Error('two'))
      .mockResolvedValue('done');

    await retry(fn, {
      attempts: 3,
      delayMs: 1,
      shouldRetry: (_error, attempt) => {
        seen.push(attempt);
        return true;
      },
    });

    expect(seen).toEqual([1, 2]);
  });

  it('retries only transient errors when paired with isTransientError', async () => {
    const simulationError = new TrustFlowError('Error(Contract, #1)', 'SIMULATION_ERROR');
    const fn = jest.fn().mockRejectedValueOnce(simulationError).mockResolvedValue('recovered');

    // The simulation error is deterministic, so the "recovered" second response
    // is never reached and the original error propagates unchanged.
    await expect(
      retry(fn, { attempts: 5, delayMs: 1, shouldRetry: isTransientError }),
    ).rejects.toBe(simulationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does retry a transient error when paired with isTransientError', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
      .mockResolvedValue('recovered');

    await expect(
      retry(fn, { attempts: 3, delayMs: 1, shouldRetry: isTransientError }),
    ).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps jittered delays inside [delay / 2, delay]', async () => {
    const delays = await collectJitteredDelays({ jitter: true, count: 200 });

    expect(delays).toHaveLength(200);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(100);
    }
    // Randomised, not constant.
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it('leaves delays untouched when jitter is disabled', async () => {
    const delays = await collectJitteredDelays({ jitter: false, count: 20 });
    expect(delays.every((d) => d === 100)).toBe(true);
  });

  it('applies a custom jitter fraction', async () => {
    const delays = await collectJitteredDelays({ jitter: 0.1, count: 100 });
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(90);
      expect(delay).toBeLessThanOrEqual(100);
    }
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it('never exceeds the computed delay, whatever the jitter setting', async () => {
    for (const jitter of [true, 0.25, 1]) {
      const delays = await collectJitteredDelays({ jitter, count: 50 });
      expect(Math.max(...delays)).toBeLessThanOrEqual(100);
    }
  });

  it('reports willRetry false to onRetry for a non-retryable failure', async () => {
    const infos: Array<{ willRetry: boolean }> = [];
    await expect(
      retry(() => Promise.reject(new Error('terminal')), {
        attempts: 4,
        delayMs: 5,
        shouldRetry: () => false,
        onRetry: (_a, _e, info) => infos.push({ willRetry: info.willRetry }),
      }),
    ).rejects.toThrow('terminal');
    expect(infos).toEqual([{ willRetry: false }]);
  });
});

describe('retry utility', () => {
  it('resolves on first attempt', async () => {
    const result = await retry(() => Promise.resolve(42), 3, 10);
    expect(result).toBe(42);
  });

  it('retries on failure and eventually resolves', async () => {
    let attempts = 0;
    const result = await retry(
      () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return Promise.resolve('ok');
      },
      5,
      10,
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws after all retries exhausted', async () => {
    await expect(retry(() => Promise.reject(new Error('always fail')), 3, 10)).rejects.toThrow(
      'always fail',
    );
  });

  it('supports RetryOptions configuration object and onRetry callback', async () => {
    let count = 0;
    const onRetryCalls: Array<{ attempt: number; error: unknown }> = [];
    const result = await retry(
      async (attempt) => {
        count++;
        if (attempt < 2) throw new Error(`error-${attempt}`);
        return 'success';
      },
      {
        attempts: 3,
        delayMs: 1,
        onRetry: (attempt, error) => onRetryCalls.push({ attempt, error }),
      },
    );

    expect(result).toBe('success');
    expect(count).toBe(2);
    expect(onRetryCalls.length).toBe(1);
    expect(onRetryCalls[0].attempt).toBe(1);
    expect((onRetryCalls[0].error as Error).message).toBe('error-1');
  });

  it('supports custom delay strategy function', async () => {
    const delayFn = jest.fn((attempt: number) => attempt * 2);
    let attempts = 0;

    const result = await retry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('delay-test');
        return 'done';
      },
      {
        attempts: 3,
        delayMs: delayFn,
      },
    );

    expect(result).toBe('done');
    expect(attempts).toBe(3);
    // The strategy also receives the error that triggered the attempt, so a
    // caller can honour `Retry-After` instead of its own schedule.
    expect(delayFn).toHaveBeenCalledWith(1, expect.any(Error));
    expect(delayFn).toHaveBeenCalledWith(2, expect.any(Error));
  });
});

describe('retry validation and onRetry semantics', () => {
  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects invalid attempts %p without calling fn',
    async (n) => {
      const fn = jest.fn().mockResolvedValue('x');
      await expect(retry(fn, n)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(fn).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-finite or negative numeric delayMs', async () => {
    const fn = jest.fn().mockResolvedValue('x');
    await expect(retry(fn, 2, -5)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(retry(fn, { attempts: 2, delayMs: NaN })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps the operation error and all attempts when onRetry throws', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('real failure'));
    await expect(
      retry(fn, {
        attempts: 3,
        delayMs: 1,
        onRetry: () => {
          throw new Error('logger crashed');
        },
      }),
    ).rejects.toThrow('real failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('reports willRetry and delayMs to onRetry when all attempts fail', async () => {
    const calls: Array<[number, { willRetry: boolean; delayMs: number }]> = [];
    await expect(
      retry(() => Promise.reject(new Error('nope')), {
        attempts: 3,
        delayMs: 2,
        onRetry: (attempt, _err, info) => calls.push([attempt, info]),
      }),
    ).rejects.toThrow('nope');
    expect(calls).toEqual([
      [1, { willRetry: true, delayMs: 2 }],
      [2, { willRetry: true, delayMs: 4 }],
      [3, { willRetry: false, delayMs: 0 }],
    ]);
  });

  it('passes the strategy function delay to onRetry', async () => {
    const delays: number[] = [];
    await expect(
      retry(() => Promise.reject(new Error('nope')), {
        attempts: 2,
        delayMs: () => 3,
        onRetry: (_a, _e, info) => delays.push(info.delayMs),
      }),
    ).rejects.toThrow('nope');
    expect(delays).toEqual([3, 0]);
  });
});
