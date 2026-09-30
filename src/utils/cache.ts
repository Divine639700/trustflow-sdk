/**
 * A small in-memory cache that expires entries after a configurable TTL.
 * Expired values are removed lazily when they are read.
 */
export class SimpleCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  /**
   * @param defaultTtlMs - Lifetime used when `set` does not receive a TTL.
   */
  constructor(private readonly defaultTtlMs: number) {}

  /** Returns a cached value, or `undefined` when it is missing or expired. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /** Stores a value for the supplied TTL. A non-positive TTL does not cache it. */
  set(key: K, value: V, ttlMs = this.defaultTtlMs): void {
    if (ttlMs <= 0) {
      this.entries.delete(key);
      return;
    }

    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Removes all cached values. */
  clear(): void {
    this.entries.clear();
  }
}
