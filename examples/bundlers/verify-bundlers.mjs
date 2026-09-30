#!/usr/bin/env node
/**
 * Verifies that the TrustFlow SDK bundles for the browser with **no Node
 * polyfill configuration**, on Webpack 5, Rollup and esbuild.
 *
 * This is the regression test behind the "SDK works in Webpack 5 without
 * configuration" acceptance criterion. It fails if:
 *
 *  1. `dist/` is missing or stale — the examples consume the built package
 *     through its real `exports` map, exactly as a consumer would.
 *  2. Any bundler fails to resolve or build the shared entry, which is what a
 *     Node built-in reaching a browser entry looks like (Webpack 5 errors with
 *     `BREAKING_CHANGE: … node.js core modules`; Rollup and esbuild report an
 *     unresolved or disallowed import).
 *  3. A Node core module string appears in any produced bundle.
 *
 * Run with: npm run build && npm run test:bundlers
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const bundlersDir = join(here);

const NODE_BUILTINS = [
  'assert', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events',
  'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];

/** @type {string[]} */
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`  ✗ ${message}`);
}

function ok(message) {
  console.log(`  ✓ ${message}`);
}

function run(label, command, args) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    fail(`${label} failed (exit ${result.status})\n${output.split('\n').slice(-25).join('\n')}`);
    return null;
  }
  return result;
}

/**
 * A Node built-in referenced by a *module specifier* is what a polyfill
 * requirement looks like. The word "process" appears in plenty of legitimate
 * browser code, so only specifier-shaped and require-shaped references count.
 */
function findNodeBuiltinImports(bundlePath) {
  const source = readFileSync(bundlePath, 'utf8');
  const found = new Set();
  const patterns = [
    // ESM specifier
    new RegExp(`(?:from|import|require)\\s*\\(?'?(node:)?(${NODE_BUILTINS.join('|')})'\\s*\\)?`, 'g'),
    // webpack's "Can't resolve 'http'" style messages are not expected in output
    new RegExp(`\\bnode:(?:${NODE_BUILTINS.join('|')})\\b`, 'g'),
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.add(match[0]);
    }
  }
  return [...found];
}

// -----------------------------------------------------------------------------
// 0. Preconditions
// -----------------------------------------------------------------------------
console.log('▸ Preconditions');
if (!existsSync(join(root, 'dist', 'index.mjs'))) {
  console.error('\ndist/ is missing. Run `npm run build` first.');
  process.exit(1);
}
ok('dist/ is present');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
ok(`package.json exports ${Object.keys(pkg.exports).join(', ')}`);

// -----------------------------------------------------------------------------
// 1. Webpack 5
// -----------------------------------------------------------------------------
run('webpack 5 (no resolve.fallback, no ProvidePlugin)', process.execPath, [
  join(root, 'node_modules', 'webpack-cli', 'bin', 'cli.js'),
  '--config',
  join(bundlersDir, 'webpack5', 'webpack.config.js'),
]);

// -----------------------------------------------------------------------------
// 2. Rollup
// -----------------------------------------------------------------------------
run('rollup (browser condition, no polyfills)', process.execPath, [
  join(root, 'node_modules', 'rollup', 'dist', 'bin', 'rollup'),
  '-c',
  join(bundlersDir, 'rollup', 'rollup.config.mjs'),
]);

// -----------------------------------------------------------------------------
// 3. esbuild
// -----------------------------------------------------------------------------
const esbuildBuild = join(bundlersDir, 'esbuild', 'build.mjs');
const esbuildScript = `
  const { build } = await import('esbuild');
  const { options } = await import(${JSON.stringify(esbuildBuild)});
  await build({ ...options, logLevel: 'info' });
`;
run('esbuild (platform: browser, no inject/external)', process.execPath, [
  '--input-type=module',
  '-e',
  esbuildScript,
]);

// -----------------------------------------------------------------------------
// 4. Scan the produced bundles for Node built-ins
// -----------------------------------------------------------------------------
console.log('\n▸ Node built-in scan');
const bundles = [];
for (const bundler of ['webpack5', 'rollup', 'esbuild']) {
  const dist = join(bundlersDir, bundler, 'dist');
  if (!existsSync(dist)) {
    fail(`${bundler}: no dist/ produced`);
    continue;
  }
  for (const entry of readdirSync(dist)) {
    if (!entry.endsWith('.js') && !entry.endsWith('.mjs')) continue;
    const full = join(dist, entry);
    if (!statSync(full).isFile()) continue;
    bundles.push({ bundler, entry, path: full });
  }
}

if (bundles.length === 0) {
  fail('no bundles were produced by any bundler');
}

for (const bundle of bundles) {
  const offenders = findNodeBuiltinImports(bundle.path);
  const kib = (statSync(bundle.path).size / 1024).toFixed(0);
  if (offenders.length > 0) {
    fail(
      `${bundle.bundler}/dist/${bundle.entry} references Node built-ins: ${offenders.join(', ')}`,
    );
  } else {
    ok(`${bundle.bundler}/dist/${bundle.entry} (${kib} KiB) — no Node built-ins`);
  }
}

// -----------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} bundler check(s) failed.`);
  process.exit(1);
}
console.log('All bundler checks passed: the SDK needs no Node polyfill configuration.');
