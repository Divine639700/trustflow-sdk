import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Enforces the compile-time contract in `tests/types/monitor-handler-types.ts`
 * (#287).
 *
 * `ts-jest` runs with `isolatedModules`, so it transpiles without type-checking:
 * `@ts-expect-error` in a normal `.test.ts` would assert nothing at all, and
 * `npm run typecheck:tests` is currently blocked by a syntax error in
 * `src/contract/read.ts` that is unrelated to this file. So the type test runs
 * here instead, over a fixture whose import graph (7 modules) deliberately
 * avoids `src/contract/*`.
 *
 * Only diagnostics reported *in the fixture* fail the test: every one of them
 * means a line the fixture expects to be an error stopped being one, or a line
 * it expects to compile stopped compiling. Diagnostics elsewhere in the graph
 * are logged rather than swallowed, but are not this test's contract.
 */
const FIXTURE = join(__dirname, 'types', 'monitor-handler-types.ts');

/** Mirrors the `tsconfig.json` options that matter for these assertions. */
const COMPILER_ARGS = [
  '--noEmit',
  '--ignoreConfig',
  '--strict',
  '--skipLibCheck',
  '--target',
  'es2022',
  '--module',
  'commonjs',
  '--moduleResolution',
  'node10',
  '--ignoreDeprecations',
  '6.0',
  '--esModuleInterop',
  '--lib',
  'es2022,dom',
  '--types',
  'node',
];

/** Runs `tsc` over `file` and returns its diagnostics, sorted for stable output. */
function tscDiagnostics(file: string): string[] {
  try {
    const stdout = execFileSync('npx', ['tsc', ...COMPILER_ARGS, file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return splitDiagnostics(stdout);
  } catch (error) {
    // tsc exits non-zero whenever it has diagnostics, which is the expected
    // path here, so the diagnostics have to be read off the thrown error.
    const { stdout, stderr } = error as { stdout?: unknown; stderr?: unknown };
    const combined = `${String(stdout ?? '')}${String(stderr ?? '')}`;
    if (!/error TS\d+/.test(combined)) throw error;
    return splitDiagnostics(combined);
  }
}

function splitDiagnostics(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => /error TS\d+/.test(line))
    .sort();
}

describe('EscrowMonitor handler typing (#287)', () => {
  let fixtureDiagnostics: string[] = [];
  let otherDiagnostics: string[] = [];

  beforeAll(() => {
    expect(existsSync(FIXTURE)).toBe(true);
    const all = tscDiagnostics(FIXTURE);
    fixtureDiagnostics = all.filter((line) => line.startsWith(FIXTURE));
    otherDiagnostics = all.filter((line) => !line.startsWith(FIXTURE));
  }, 60_000);

  it('has no diagnostics in the type-level fixture', () => {
    if (otherDiagnostics.length > 0) {
      // Not a failure, but a regression hiding in here should not go unnoticed.
      console.warn(
        `${otherDiagnostics.length} diagnostic(s) outside the fixture, unrelated to this test:\n` +
          otherDiagnostics.join('\n'),
      );
    }
    expect(fixtureDiagnostics).toEqual([]);
  });

  it('actually rejects a wrong event name', () => {
    // Guards against the fixture passing vacuously: the same compiler, same
    // flags, same module — only without the @ts-expect-error suppression —
    // must report the typo as an error.
    const dir = mkdtempSync(join(tmpdir(), 'trustflow-monitor-types-'));
    const probe = join(dir, 'probe.ts');
    writeFileSync(
      probe,
      [
        `import { EscrowMonitor } from ${JSON.stringify(join(__dirname, '..', 'src', 'escrow', 'monitor'))};`,
        'const monitor = new EscrowMonitor();',
        "monitor.on('not_an_event', () => {});",
        '',
      ].join('\n'),
    );
    try {
      // The typo is reported as an overload mismatch on the `probe.ts` line,
      // with each overload listing the names it does accept. tsc prints paths
      // relative to its cwd, so match on the file name rather than the path.
      const probeDiagnostics = tscDiagnostics(probe).filter((line) => line.includes('probe.ts('));
      expect(probeDiagnostics.length).toBeGreaterThan(0);
      expect(probeDiagnostics.join('\n')).toMatch(/error TS2769/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
