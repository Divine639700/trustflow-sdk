/**
 * Connection-pool *configuration and observability*, with no dependency on
 * Node's `http`/`https` modules.
 *
 * ### Why this module is not bundled with the SDK's browser entry
 *
 * The Node `http.Agent`/`https.Agent` classes only exist in Node. Importing
 * them from a module that the package root re-exports forced every browser
 * consumer to configure a `resolve.fallback` polyfill for `http`, `https` (and,
 * transitively, `stream`, `buffer`, `crypto`) before the SDK would build at
 * all — even for callers who never touch connection pooling.
 *
 * So the two halves are split by environment:
 *
 * - **This module** — the structural types and the read-only helpers
 *   (`getHttpAgentStats`, `destroyPoolAgent`, `monitorPoolHealth`). They accept
 *   any object shaped like an agent, so they type-check against Node's
 *   `http.Agent` without importing it, and they work in a browser.
 * - **`@trustflow/sdk/node`** — the factories that actually construct a Node
 *   agent (`createHttpAgent`, `createHttpsAgent`,
 *   `configureAxiosConnectionPool`). Importing that entry in a browser is a
 *   mistake, and it is documented as Node-only.
 *
 * @see {@link PooledAgent}
 */

export interface PoolConfig {
  /** Maximum number of sockets to keep alive per host. Defaults to 50. */
  maxSockets?: number;
  /** Maximum number of requests to queue when sockets are at max. Defaults to 256. */
  maxFreeSockets?: number;
  /** Socket timeout in milliseconds. Defaults to 60000. */
  socketTimeoutMs?: number;
  /**
   * Idle-time before a pooled connection is closed, in milliseconds. Defaults
   * to 30000.
   *
   * Node applies this as `http.Server`'s `keepAliveTimeout`; a client `Agent`
   * has no equivalent option, so the `@trustflow/sdk/node` agent factories
   * accept but do not apply it. See {@link createHttpAgent}.
   */
  keepAliveTimeoutMs?: number;
  /** Keep-alive initial delay in milliseconds. Defaults to 1000. */
  keepAliveInitialDelayMs?: number;
}

export const DEFAULT_POOL_CONFIG: Required<PoolConfig> = {
  maxSockets: 50,
  maxFreeSockets: 256,
  socketTimeoutMs: 60_000,
  keepAliveTimeoutMs: 30_000,
  keepAliveInitialDelayMs: 1_000,
};

/**
 * The subset of Node's `http.Agent` / `https.Agent` surface this module uses,
 * declared structurally.
 *
 * Declaring the shape here rather than importing `http.Agent` is what keeps
 * `http`/`https` out of the browser bundle while remaining type-compatible
 * with the real agents — a Node `http.Agent` satisfies this interface, so
 * `getHttpAgentStats(agentFromNode)` still type-checks.
 */
export interface PooledAgent {
  /** Live sockets, keyed by `host:port`. */
  sockets?: Readonly<Record<string, unknown[]>>;
  /** Idle sockets, keyed by `host:port`. */
  freeSockets?: Readonly<Record<string, unknown[]>>;
  /** Requests queued per host. */
  requests?: Readonly<Record<string, number>>;
  /** Closes every socket. */
  destroy(): void;
  /** Enables TCP keep-alive. */
  keepSocketAlive?: boolean;
}

/**
 * Pool statistics for monitoring and debugging.
 */
export interface PoolStats {
  totalSockets: number;
  freeSockets: number;
  socketsPerHost: Record<string, number>;
  requestsQueued: number;
}

/**
 * Reads pool statistics from any agent shaped like Node's.
 *
 * @param agent - A Node `http.Agent`/`https.Agent`, or anything matching
 *   {@link PooledAgent}
 * @returns Socket counts, per-host socket counts, and the queued-request count
 *
 * @example
 * ```typescript
 * import { getHttpAgentStats } from '@trustflow/sdk';
 * import { createHttpAgent } from '@trustflow/sdk/node';
 *
 * console.log(getHttpAgentStats(createHttpAgent({ maxSockets: 10 })));
 * ```
 */
export function getHttpAgentStats(agent: PooledAgent): PoolStats {
  const socketsPerHost: Record<string, number> = {};
  for (const [host, sockets] of Object.entries(agent.sockets ?? {})) {
    socketsPerHost[host] = Array.isArray(sockets) ? sockets.length : 0;
  }

  let totalSockets = 0;
  for (const count of Object.values(socketsPerHost)) {
    totalSockets += count;
  }

  let freeSockets = 0;
  for (const sockets of Object.values(agent.freeSockets ?? {})) {
    freeSockets += Array.isArray(sockets) ? sockets.length : 0;
  }

  const requestsQueued = Object.values(agent.requests ?? {}).reduce(
    (sum, queued) => sum + (typeof queued === 'number' ? queued : 0),
    0,
  );

  return { totalSockets, freeSockets, socketsPerHost, requestsQueued };
}

/**
 * Closes all connections in a pool agent. Call during graceful shutdown.
 *
 * @param agent - A Node `http.Agent`/`https.Agent`, or anything matching
 *   {@link PooledAgent}
 */
export function destroyPoolAgent(agent: PooledAgent): void {
  agent.destroy();
}

/**
 * Configuration for monitoring pool health.
 */
export interface PoolMonitorConfig {
  /** Interval to check pool stats in milliseconds. Defaults to 10000. */
  checkIntervalMs?: number;
  /** Callback when stats are collected. */
  onStats?: (stats: PoolStats) => void;
  /** Callback when warnings are triggered. */
  onWarning?: (warning: string) => void;
  /** Warning threshold for free sockets. If below this, triggers warning. Defaults to 10. */
  warningFreeSocketsThreshold?: number;
}

/**
 * Polls a pool agent's health and reports statistics and low-socket warnings.
 *
 * @param agent - Agent to poll
 * @param config - Optional polling interval, thresholds and callbacks
 * @returns A cleanup function that stops the polling interval
 */
export function monitorPoolHealth(agent: PooledAgent, config?: PoolMonitorConfig): () => void {
  const finalConfig = {
    checkIntervalMs: config?.checkIntervalMs ?? 10_000,
    warningFreeSocketsThreshold: config?.warningFreeSocketsThreshold ?? 10,
  };

  const interval = setInterval(() => {
    const stats = getHttpAgentStats(agent);

    if (config?.onStats) {
      config.onStats(stats);
    }

    if (stats.freeSockets < finalConfig.warningFreeSocketsThreshold) {
      const warning = `Connection pool running low: ${stats.freeSockets} free sockets remaining`;
      if (config?.onWarning) {
        config.onWarning(warning);
      }
    }
  }, finalConfig.checkIntervalMs);

  return () => clearInterval(interval);
}
