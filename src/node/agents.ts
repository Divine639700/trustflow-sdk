/**
 * Node-only HTTP connection-pool factories.
 *
 * This is the SDK's `@trustflow/sdk/node` entry. It is the *only* place in the
 * package that references Node's `http` / `https` built-ins, which is what lets
 * the root, `/escrow`, `/wallet`, `/react` and `/utils` entries bundle in a
 * browser (Webpack 5, Rollup, Vite, esbuild) with no `resolve.fallback` and no
 * `node:` polyfills.
 *
 * Importing this entry in a browser bundle is a mistake: bundlers resolve
 * `http`/`https` to shims or fail, and the agents have no meaning there
 * anyway. Browser code has no equivalent concept — the browser manages its own
 * per-origin connection pool.
 *
 * The environment-agnostic half of the API (`PoolConfig`, `PoolStats`,
 * `getHttpAgentStats`, `monitorPoolHealth`, `destroyPoolAgent`) lives in the
 * root entry and is safe everywhere.
 *
 * @example
 * ```typescript
 * // server.ts / cli.ts only
 * import { createApiHttpClient } from '@trustflow/sdk/utils';
 * import { configureAxiosConnectionPool } from '@trustflow/sdk/node';
 *
 * const http = createApiHttpClient({ baseURL: 'https://api.trustflow.xyz' });
 * configureAxiosConnectionPool(http, { maxSockets: 100 });
 * ```
 */

import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { AxiosInstance } from 'axios';
import { DEFAULT_POOL_CONFIG, type PoolConfig } from '../utils/connection-pool';

export type {
  PoolConfig,
  PoolStats,
  PooledAgent,
  PoolMonitorConfig,
} from '../utils/connection-pool';
export {
  DEFAULT_POOL_CONFIG,
  getHttpAgentStats,
  monitorPoolHealth,
  destroyPoolAgent,
} from '../utils/connection-pool';

/**
 * Creates a keep-alive HTTP agent with connection pooling.
 *
 * Note on `keepAliveTimeoutMs`: it is a **server**-side knob in Node
 * (`http.Server`'s `keepAliveTimeout`, the idle time before the server closes a
 * connection). A client `Agent` has no equivalent constructor option — its idle
 * sockets live until the peer closes them — so the field is accepted (callers
 * pass one config object to both agents and servers) but does not affect the
 * agent. Socket lifetime here is governed by `socketTimeoutMs` and
 * `keepAliveInitialDelayMs`.
 *
 * @param config - Overrides for {@link DEFAULT_POOL_CONFIG}
 * @returns A Node `http.Agent`
 */
export function createHttpAgent(config?: PoolConfig): HttpAgent {
  const finalConfig = { ...DEFAULT_POOL_CONFIG, ...config };

  return new HttpAgent({
    keepAlive: true,
    maxSockets: finalConfig.maxSockets,
    maxFreeSockets: finalConfig.maxFreeSockets,
    timeout: finalConfig.socketTimeoutMs,
    keepAliveMsecs: finalConfig.keepAliveInitialDelayMs,
  });
}

/**
 * Creates a keep-alive HTTPS agent with connection pooling.
 *
 * See {@link createHttpAgent} for how `keepAliveTimeoutMs` is treated.
 *
 * @param config - Overrides for {@link DEFAULT_POOL_CONFIG}
 * @returns A Node `https.Agent`
 */
export function createHttpsAgent(config?: PoolConfig): HttpsAgent {
  const finalConfig = { ...DEFAULT_POOL_CONFIG, ...config };

  return new HttpsAgent({
    keepAlive: true,
    maxSockets: finalConfig.maxSockets,
    maxFreeSockets: finalConfig.maxFreeSockets,
    timeout: finalConfig.socketTimeoutMs,
    keepAliveMsecs: finalConfig.keepAliveInitialDelayMs,
  });
}

/**
 * Applies keep-alive connection-pooling to an axios instance, for a
 * long-running Node process that would otherwise exhaust sockets.
 *
 * @param instance - The axios instance to configure
 * @param config - Overrides for {@link DEFAULT_POOL_CONFIG}
 */
export function configureAxiosConnectionPool(instance: AxiosInstance, config?: PoolConfig): void {
  instance.defaults.httpAgent = createHttpAgent(config);
  instance.defaults.httpsAgent = createHttpsAgent(config);
}
