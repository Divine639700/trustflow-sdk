/**
 * Configuration options for request deduplication.
 */
export interface DeduplicationOptions {
  /**
   * Optional cache duration in milliseconds to keep resolved results available
   * for subsequent calls after the in-flight promise resolves.
   * If 0 or omitted, the result is evicted immediately once all concurrent in-flight
   * callers receive the response.
   */
  ttlMs?: number;
  /** Force bypassing of any cached responses. */
  skipCache?: boolean;
}

/**
 * Coalesces identical concurrent asynchronous requests into a single in-flight Promise.
 *
 * When multiple components or functions trigger identical async requests at the same time,
 * RequestDeduplicator shares the active Promise across all callers, avoiding redundant network
 * traffic and server load. Once the request settles (fulfills or rejects), the in-flight slot
 * is cleaned up immediately, and errors propagate cleanly to every waiting caller.
 */
export class RequestDeduplicator {
  private readonly inFlight = new Map<string, Promise<any>>();
  private readonly resolvedCache = new Map<string, { value: any; expiresAt: number }>();

  /**
   * Executes or shares an in-flight promise for the given key.
   *
   * @param key - Unique string identifier (typically method + serialized parameters)
   * @param factory - Async operation to execute if no identical call is in-flight
   * @param options - Deduplication and optional TTL options
   */
  async deduplicate<T>(
    key: string,
    factory: () => Promise<T>,
    options?: DeduplicationOptions,
  ): Promise<T> {
    if (!options?.skipCache) {
      const cached = this.resolvedCache.get(key);
      if (cached) {
        if (cached.expiresAt > Date.now()) {
          return cached.value as T;
        }
        this.resolvedCache.delete(key);
      }
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = (async () => {
      try {
        const result = await factory();
        if (options?.ttlMs && options.ttlMs > 0) {
          this.resolvedCache.set(key, {
            value: result,
            expiresAt: Date.now() + options.ttlMs,
          });
        }
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Checks whether a request with the given key is currently in flight.
   */
  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  /**
   * Returns the count of currently in-flight requests.
   */
  getInFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Clears all in-flight trackers and cached entries.
   */
  clear(): void {
    this.inFlight.clear();
    this.resolvedCache.clear();
  }
}
