import * as fs from 'fs';
import * as path from 'path';

/**
 * Enforces the "no Node polyfills required in a browser bundle" guarantee
 * statically, so a regression is caught by `npm test` rather than by a user
 * hitting a Webpack 5 `BREAKING_CHANGE` error.
 *
 * `examples/bundlers/verify-bundlers.mjs` proves the end-to-end result on
 * Webpack 5, Rollup and esbuild. This file proves the invariant at the source
 * level, which is cheap enough to run on every test invocation and does not need
 * a build.
 *
 * @see docs/BROWSER_COMPATIBILITY.md
 */

const srcDir = path.resolve(__dirname, '../src');
const repoRoot = path.resolve(__dirname, '..');

/**
 * Node core modules. Matching is on the import specifier, so a variable or a
 * string literal containing one of these names is not flagged.
 */
const NODE_BUILTINS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

/** Entry points that must be safe to bundle for a browser. */
const BROWSER_ENTRIES = [
  'src/index.ts',
  'src/escrow/index.ts',
  'src/wallet/index.ts',
  'src/utils/index.ts',
  'src/hooks/index.ts',
];

/**
 * The only directory allowed to reach for Node built-ins. It backs the
 * `@trustflow/sdk/node` entry and is not reachable from any browser entry.
 */
const NODE_ONLY_DIR = 'src/node';

function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...allSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** `import x from 'node:fs'` / `require('fs')` / `export ... from 'fs'`. */
function nodeBuiltinImports(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = (match[1] ?? '').replace(/^node:/, '');
      if (NODE_BUILTINS.has(specifier)) specifiers.push(match[1]!);
    }
  }
  return specifiers;
}

/** Walks the static import graph from `entry`, relative to `src/`. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.resolve(repoRoot, entry)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');

    const relativeImports: string[] = [];
    const patterns = [
      /(?:^|[\s;}])import\s+(?:type\s+)?[^'";]*?from\s*['"](\.[^'"]+)['"]/g,
      /(?:^|[\s;}])export\s+(?:type\s+)?[^'";]*?from\s*['"](\.[^'"]+)['"]/g,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        relativeImports.push(match[1]!);
      }
    }

    for (const specifier of relativeImports) {
      const base = path.resolve(path.dirname(file), specifier);
      for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), `${base}.d.ts`]) {
        if (fs.existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }

  return seen;
}

describe('browser bundle compatibility', () => {
  it.each(BROWSER_ENTRIES)('%s and its static imports are free of Node built-ins', (entry) => {
    const offenders: string[] = [];
    for (const file of reachableFrom(entry)) {
      for (const specifier of nodeBuiltinImports(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(repoRoot, file)} imports "${specifier}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps node:http / node:https confined to the @trustflow/sdk/node entry', () => {
    const nodeOnly = path.resolve(repoRoot, NODE_ONLY_DIR);
    const offenders: string[] = [];

    for (const file of allSourceFiles(srcDir)) {
      if (file.startsWith(`${nodeOnly}${path.sep}`)) continue;
      for (const specifier of nodeBuiltinImports(fs.readFileSync(file, 'utf8'))) {
        if (!['http', 'https', 'node:http', 'node:https'].includes(specifier)) continue;
        offenders.push(`${path.relative(repoRoot, file)} imports "${specifier}"`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('actually does keep the node entry on the node built-ins', () => {
    const agents = fs.readFileSync(path.join(repoRoot, NODE_ONLY_DIR, 'agents.ts'), 'utf8');
    expect(agents).toMatch(/from 'node:http'/);
    expect(agents).toMatch(/from 'node:https'/);
  });

  it('declares the node: specifiers as external so the build does not try to bundle them', () => {
    const tsupConfig = fs.readFileSync(path.join(repoRoot, 'tsup.config.ts'), 'utf8');
    expect(tsupConfig).toMatch(/external:\s*\[[^\]]*node:http[^\]]*\]/);
    expect(tsupConfig).toMatch(/external:\s*\[[^\]]*node:https[^\]]*\]/);
  });

  it('builds the neutral (not node) platform, so no entry silently gains built-ins', () => {
    const tsupConfig = fs.readFileSync(path.join(repoRoot, 'tsup.config.ts'), 'utf8');
    expect(tsupConfig).toMatch(/platform:\s*'neutral'/);
  });

  it('does not depend on axios-retry, whose CommonJS-only build breaks strict-ESM bundlers', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies)).not.toContain('axios-retry');
  });

  it('publishes a ./node subpath for the Node-only pooling helpers', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.exports['./node']).toEqual({
      types: './dist/node/index.d.ts',
      import: './dist/node/index.mjs',
      require: './dist/node/index.js',
    });
  });

  it('exposes the pooling factories only from the node entry, not the root', () => {
    const rootIndex = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    // The root may re-export the agnostic helpers, never the agent factories.
    expect(rootIndex).not.toMatch(/from '\.\/node'/);

    const connectionPool = fs.readFileSync(path.join(srcDir, 'utils/connection-pool.ts'), 'utf8');
    for (const factory of ['createHttpAgent', 'createHttpsAgent', 'configureAxiosConnectionPool']) {
      expect(connectionPool).not.toMatch(new RegExp(`export function ${factory}\\b`));
    }
  });

  it('documents the compatibility matrix', () => {
    const doc = fs.readFileSync(path.join(repoRoot, 'docs/BROWSER_COMPATIBILITY.md'), 'utf8');
    expect(doc).toMatch(/Safari\s*\|\s*\*\*15\.4\*\*/);
    expect(doc).toMatch(/Webpack 5\*\*\s*\|\s*none\s*\|\s*Verified/);
    expect(doc).toMatch(/esbuild\*\*\s*\|\s*none/);
    expect(doc).toMatch(/UNSUPPORTED_ENVIRONMENT/);
    expect(doc).toMatch(/npm run test:bundlers/);
  });

  it('ships a Webpack 5 example with no resolve.fallback or ProvidePlugin', () => {
    const config = fs.readFileSync(
      path.join(repoRoot, 'examples/bundlers/webpack5/webpack.config.js'),
      'utf8',
    );
    expect(config).toMatch(/target:\s*'web'/);
    // No Node polyfill configuration of any kind: no `fallback` map, no
    // ProvidePlugin, no `node:` alias.
    expect(config).not.toMatch(/fallback\s*:/);
    expect(config).not.toMatch(/new webpack\.ProvidePlugin/);
    expect(config).not.toMatch(/alias\s*:/);
    expect(config).toMatch(/NoNodeBuiltinsPlugin/);
  });
});
