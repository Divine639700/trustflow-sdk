import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * #304 — the root and every subpath entry must share one copy of TrustFlowError and the
 * escrow classes, in both CJS and ESM output. Builds into a temporary directory and runs
 * the same check CI runs against `dist/`.
 */
const root = path.resolve(__dirname, '..');

describe('built entries share module identity (#304)', () => {
  let outDir: string;

  beforeAll(() => {
    // Inside the project tree (and therefore inside `node_modules/`, which is
    // gitignored) so the built files resolve the SDK's own dependencies —
    // `require('axios')` from an OS temp dir cannot walk up to them, for the
    // CJS *and* ESM halves of the check.
    const cacheRoot = path.join(root, 'node_modules', '.cache');
    fs.mkdirSync(cacheRoot, { recursive: true });
    outDir = fs.mkdtempSync(path.join(cacheRoot, 'trustflow-dist-'));
    execFileSync('npx', ['tsup', '--no-dts', '--out-dir', outDir], { cwd: root, stdio: 'pipe' });
  }, 180_000);

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('exposes identical classes and error identity across entries', () => {
    expect(() =>
      execFileSync('node', [path.join(root, 'scripts', 'check-dist-identity.js'), outDir], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  }, 60_000);
});
