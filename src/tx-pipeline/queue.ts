import { TrustFlowError } from '../errors';

interface Lane {
  /** Settles once the most recently queued run has released the lane. */
  tail: Promise<void>;
  /** Runs holding or waiting for the lane. */
  depth: number;
}

const lanes = new Map<string, Lane>();

/** Builds the lane key shared by every pipeline talking to the same network as the same account. */
export function queueKey(networkPassphrase: string, sourceAccount: string): string {
  return `${networkPassphrase}:${sourceAccount}`;
}

/** Number of runs currently holding or waiting for the lane identified by `key`. */
export function queueDepth(key: string): number {
  return lanes.get(key)?.depth ?? 0;
}

/**
 * Runs `fn` once every earlier `runExclusive` call with the same `key` has
 * finished, and always releases the lane afterwards, whether `fn` resolves or
 * throws. Different keys never wait for each other.
 *
 * The lane state lives in this module, so it is shared by every caller in the
 * current process and is not coordinated across processes.
 *
 * @param key - Lane identifier, see {@link queueKey}
 * @param fn - Work to run while holding the lane
 * @param timeoutMs - Maximum time to wait for the lane; rejects with a `TIMEOUT`
 *   {@link TrustFlowError} without running `fn` once exceeded. Waits indefinitely when omitted.
 */
export async function runExclusive<T>(
  key: string,
  fn: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  let lane = lanes.get(key);
  if (!lane) {
    lane = { tail: Promise.resolve(), depth: 0 };
    lanes.set(key, lane);
  }
  const current = lane;
  const previous = current.tail;
  let release!: () => void;
  current.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  current.depth++;

  const leave = (): void => {
    current.depth--;
    if (current.depth === 0 && lanes.get(key) === current) {
      lanes.delete(key);
    }
  };

  if (timeoutMs === undefined) {
    await previous;
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    });
    const expired = await Promise.race([previous.then(() => false), timedOut]);
    clearTimeout(timer);
    if (expired) {
      // Later runs must still wait for the run we gave up on, so only free
      // our slot in the chain once it has released.
      void previous.then(release);
      leave();
      throw TrustFlowError.queueTimeout(timeoutMs);
    }
  }

  try {
    return await fn();
  } finally {
    release();
    leave();
  }
}
