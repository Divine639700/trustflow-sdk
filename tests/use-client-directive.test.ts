import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The `@trustflow/sdk/react` entry must ship as a client module.
 *
 * `src/hooks/*` calls `useState`, `useEffect` and `useCallback`, so in the
 * Next.js App Router importing it from a Server Component (or from any file
 * that is not itself a client module) fails unless the module declares
 * `'use client'`. A directive in the source is not enough — bundlers drop
 * module-level directives — so it is injected into the emitted files by
 * `scripts/inject-use-client.js`, which runs as part of `npm run build`.
 *
 * Builds into a temporary directory and asserts against that output, the same
 * way `dist-entry-identity` does, so the check does not depend on a `dist/`
 * left over from a previous run (CI runs `npm test` before `npm run build`).
 *
 * Next.js's own webpack loader is what ultimately has to agree, which cannot be
 * exercised here (Next.js is not a dependency of this package). The manual
 * equivalent, once the directive is in place: in an App Router project, import a
 * hook from a file with no `'use client'` of its own —
 *
 *   // app/page.tsx
 *   import { useWallet } from '@trustflow/sdk/react';
 *
 * — and `npm run build`. Before the fix this fails with "You're importing a
 * component that needs useState… mark it with 'use client'"; after it, the page
 * builds and renders. Worth re-checking after a Next.js major bump, since the
 * directive's handling lives in the consumer's bundler, not in this package.
 */

const root = path.resolve(__dirname, '..');
const REACT_ENTRIES = ['hooks/index.js', 'hooks/index.mjs'];
/** Entries that are safe on a server and must therefore stay unmarked. */
const SERVER_ENTRIES = [
  'index.js',
  'index.mjs',
  'escrow/index.js',
  'escrow/index.mjs',
  'wallet/index.js',
  'wallet/index.mjs',
  'utils/index.js',
  'utils/index.mjs',
];
const DIRECTIVE = "'use client';";

describe("built react entry declares 'use client'", () => {
  let outDir: string;
  let read: (file: string) => string;

  beforeAll(() => {
    // Inside the project tree (and therefore inside the gitignored
    // `node_modules/`) so the built files resolve the SDK's own dependencies.
    const cacheRoot = path.join(root, 'node_modules', '.cache');
    fs.mkdirSync(cacheRoot, { recursive: true });
    outDir = fs.mkdtempSync(path.join(cacheRoot, 'trustflow-use-client-'));

    // The two halves of `npm run build`, pointed at the temporary outDir. The
    // script string itself is asserted separately below — passing `--out-dir`
    // through `npm run` would append it to the *last* command in the chain
    // rather than to tsup.
    execFileSync('npx', ['tsup', '--no-dts', '--out-dir', outDir], { cwd: root, stdio: 'pipe' });
    execFileSync('node', [path.join(root, 'scripts', 'inject-use-client.js'), outDir], {
      cwd: root,
      stdio: 'pipe',
    });

    read = (file: string) => fs.readFileSync(path.join(outDir, file), 'utf8');
  }, 180_000);

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it.each(REACT_ENTRIES)('%s starts with the directive', (file) => {
    expect(read(file).split('\n')[0]).toBe(DIRECTIVE);
  });

  it.each(REACT_ENTRIES)('%s is still valid, loadable JavaScript', (file) => {
    const source = read(file);
    // The directive is a leading string-literal expression, i.e. part of a
    // directive prologue, so the module parses and keeps its exports.
    expect(source).toMatch(/^'use client';\n/);
    expect(source).toMatch(/\bexports\b|\bexport\b/);
  });

  it.each(SERVER_ENTRIES)('%s does not contain the directive', (file) => {
    expect(read(file)).not.toContain("'use client'");
  });

  it('does not put the directive in a shared chunk the server entries load', () => {
    // The React entry shares chunks with the root entry for TrustFlowError and
    // the escrow classes (#304). Marking a shared chunk would make the whole
    // SDK a client module, defeating the separate `/react` subpath.
    const shared = fs
      .readdirSync(outDir)
      .filter((f) => /^chunk-.*\.(js|mjs)$/.test(f))
      .map((f) => fs.readFileSync(path.join(outDir, f), 'utf8'));

    expect(shared.length).toBeGreaterThan(0);
    for (const source of shared) {
      expect(source).not.toContain("'use client'");
    }
  });

  it('the injection script is idempotent', () => {
    const target = path.join(outDir, 'hooks/index.js');
    const before = fs.readFileSync(target, 'utf8');

    execFileSync('node', [path.join(root, 'scripts', 'inject-use-client.js'), outDir], {
      cwd: root,
      stdio: 'pipe',
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(before);
    expect(before.split("'use client'")).toHaveLength(2);
  });
});

describe('npm run build wires the injection step in', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('runs it after tsup', () => {
    expect(pkg.scripts.build).toContain('tsup');
    expect(pkg.scripts.build).toContain('scripts/inject-use-client.js');
    expect(pkg.scripts.build.indexOf('tsup')).toBeLessThan(
      pkg.scripts.build.indexOf('scripts/inject-use-client.js'),
    );
  });
});
