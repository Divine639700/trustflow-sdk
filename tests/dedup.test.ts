import { RequestDeduplicator } from '../src/utils/dedup';

describe('RequestDeduplicator', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    deduplicator = new RequestDeduplicator();
  });

  it('shares a single promise across concurrent identical requests', async () => {
    let callCount = 0;
    const asyncTask = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 20));
      return 'result-123';
    };

    const results = await Promise.all([
      deduplicator.deduplicate('task-key', asyncTask),
      deduplicator.deduplicate('task-key', asyncTask),
      deduplicator.deduplicate('task-key', asyncTask),
      deduplicator.deduplicate('task-key', asyncTask),
    ]);

    expect(callCount).toBe(1);
    expect(results).toEqual(['result-123', 'result-123', 'result-123', 'result-123']);
    expect(deduplicator.getInFlightCount()).toBe(0);
  });

  it('executes separate tasks for different keys', async () => {
    let callCount = 0;
    const asyncTask = async (id: number) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return `result-${id}`;
    };

    const [resA, resB] = await Promise.all([
      deduplicator.deduplicate('key-a', () => asyncTask(1)),
      deduplicator.deduplicate('key-b', () => asyncTask(2)),
    ]);

    expect(callCount).toBe(2);
    expect(resA).toBe('result-1');
    expect(resB).toBe('result-2');
  });

  it('propagates errors to all concurrent callers and cleans up in-flight slot', async () => {
    let attempts = 0;
    const failingTask = async () => {
      attempts++;
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('Network failure');
    };

    const promises = [
      deduplicator.deduplicate('fail-key', failingTask),
      deduplicator.deduplicate('fail-key', failingTask),
    ];

    await Promise.all(
      promises.map((p) =>
        expect(p).rejects.toThrow('Network failure'),
      ),
    );

    expect(attempts).toBe(1);
    expect(deduplicator.getInFlightCount()).toBe(0);

    // Subsequent call after failure should trigger a fresh attempt
    const successTask = async () => 'recovered';
    const res = await deduplicator.deduplicate('fail-key', successTask);
    expect(res).toBe('recovered');
  });

  it('supports optional TTL caching of resolved responses', async () => {
    let callCount = 0;
    const task = async () => {
      callCount++;
      return 'data';
    };

    await deduplicator.deduplicate('ttl-key', task, { ttlMs: 1000 });
    const cachedRes = await deduplicator.deduplicate('ttl-key', task, { ttlMs: 1000 });

    expect(callCount).toBe(1);
    expect(cachedRes).toBe('data');

    // Bypassing cache with skipCache
    const freshRes = await deduplicator.deduplicate('ttl-key', task, { skipCache: true });
    expect(callCount).toBe(2);
    expect(freshRes).toBe('data');
  });
});
