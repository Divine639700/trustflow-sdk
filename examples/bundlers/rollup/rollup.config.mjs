import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { transformSync } from 'esbuild';

/** Node core modules that must never reach a browser bundle. */
const NODE_BUILTINS = [
  'assert', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events',
  'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];

/**
 * Rollup browser build of the TrustFlow SDK.
 *
 * ## The point of this file
 *
 * Rollup has **no Node polyfills at all** and no equivalent of Webpack's
 * `resolve.fallback`: a Node built-in reachable from the SDK's browser entries
 * is an unresolved-import error, not a silently bundled shim. That is the
 * guarantee these examples exist to prove.
 *
 * `browser: true` makes the resolver honour the `browser` export condition, so
 * `@stellar/stellar-sdk` resolves to its prebundled browser build.
 *
 * ## Why `commonjs` is here (and why it is not a polyfill)
 *
 * That prebundled build is UMD (`module.exports = factory()`), not ESM, so a
 * strict-ESM bundler cannot take named imports from it. `@rollup/plugin-commonjs`
 * is the standard answer, is not a Node polyfill, and is required by
 * `@stellar/stellar-sdk` rather than by this SDK — the TrustFlow sources and
 * every `@trustflow/sdk` entry are ESM. It is listed here so the example is
 * copy-pasteable, and in the docs so the requirement is not a surprise.
 *
 * Run with: npm run test:bundlers
 */
export default {
  input: new URL('../shared-entry.ts', import.meta.url).pathname,
  output: {
    file: new URL('dist/bundle.js', import.meta.url).pathname,
    format: 'esm',
    sourcemap: true,
  },
  plugins: [
    nodeResolve({
      browser: true,
      extensions: ['.mjs', '.js', '.json', '.ts'],
    }),
    commonjs(),
    {
      // The example's own source is TypeScript. esbuild is already a dependency
      // of this repo, so the bundler examples need no extra TS plugin.
      name: 'trustflow-example-ts',
      transform(code, id) {
        if (!id.endsWith('.ts')) return null;
        const result = transformSync(code, {
          loader: 'ts',
          target: 'es2020',
          format: 'esm',
          sourcemap: true,
          sourcefile: id,
        });
        return { code: result.code, map: result.map || null };
      },
    },
    {
      // Fails the build if a Node core module was resolved into the bundle.
      name: 'no-node-builtins',
      generateBundle(_options, bundle) {
        const offenders = [];
        for (const chunk of Object.values(bundle)) {
          for (const moduleId of Object.keys(chunk.modules ?? {})) {
            const specifier = moduleId.replace(/^[a-z]+:/i, '');
            if (NODE_BUILTINS.includes(specifier)) offenders.push(moduleId);
          }
        }
        if (offenders.length > 0) {
          throw new Error(
            `Node core modules reached the browser bundle: ${offenders.join(', ')}. ` +
              'The SDK browser entries must stay free of Node built-ins.',
          );
        }
      },
    },
  ],
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    // `'use client'` is emitted into the React entry by
    // scripts/inject-use-client.js and is consumed by the consumer's own
    // bundler, not by this example.
    if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
    warn(warning);
  },
};
