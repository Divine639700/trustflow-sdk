import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Package metadata that `npm pack`, `publint` and npm provenance all depend on.
 * None of it is exercised by the behavioural suites, so it is asserted here —
 * a regression would only otherwise surface at publish time.
 */

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>;

/** `npm test` runs before `npm run build` in CI, so dist/ may not exist yet. */
const DIST_BUILT = fs.existsSync(path.join(root, 'dist', 'index.js'));

describe('LICENSE file', () => {
  const licensePath = path.join(root, 'LICENSE');

  it('exists, since package.json declares "license": "MIT"', () => {
    expect(pkg.license).toBe('MIT');
    expect(fs.existsSync(licensePath)).toBe(true);
  });

  it('carries the MIT permission text and the copyright line the README quotes', () => {
    const text = fs.readFileSync(licensePath, 'utf8');

    expect(text).toMatch(/^MIT License/);
    expect(text).toContain('Copyright (c) 2026 TrustFlow Protocol');
    expect(text).toContain('Permission is hereby granted, free of charge');
    expect(text).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  it('matches the copyright line in the README, so its LICENSE link resolves', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

    expect(readme).toContain('[LICENSE](./LICENSE)');
    expect(readme).toContain('MIT License - Copyright (c) 2026 TrustFlow Protocol');
  });
});

describe('published tarball contents', () => {
  // `npm pack` always includes package.json, the README and the LICENSE
  // regardless of `files`, so the LICENSE ships without listing it.
  let files: string[];

  beforeAll(() => {
    const [pack] = JSON.parse(
      execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: root,
        encoding: 'utf8',
      }),
    ) as [{ files: { path: string }[] }];
    files = pack.files.map((f) => f.path);
  }, 60_000);

  it('includes the LICENSE', () => {
    expect(files).toContain('LICENSE');
  });

  it('includes package.json and the README, and nothing unexpected', () => {
    expect(files).toContain('package.json');
    expect(files).toContain('README.md');

    const unexpected = files.filter(
      (f) => !/^(dist\/|package\.json$|README(\.[a-z]+)?$|LICENSE(\.[a-z]+)?$)/i.test(f),
    );
    expect(unexpected).toEqual([]);
  });

  // `npm test` runs before `npm run build` in CI, so dist/ is absent on a fresh
  // checkout. The dist assertions are exercised for real after a build.
  (DIST_BUILT ? it : it.skip)('includes every file the exports map points at', () => {
    const exportsMap = pkg.exports as Record<string, Record<string, string>>;
    for (const [subpath, conditions] of Object.entries(exportsMap)) {
      for (const [condition, target] of Object.entries(conditions)) {
        expect(`${subpath} ${condition}`).toBeTruthy();
        // Targets are written as './dist/...'; the tarball paths are not.
        expect(files).toContain(target.replace(/^\.\//, ''));
      }
    }
  });
});

describe('package.json metadata', () => {
  it('declares "type": "commonjs", matching the .js/.mjs output split', () => {
    expect(pkg.type).toBe('commonjs');
  });

  (DIST_BUILT ? it : it.skip)('emits both a .js and an .mjs entry for that "type"', () => {
    expect(fs.existsSync(path.join(root, 'dist', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'dist', 'index.mjs'))).toBe(true);
  });

  it('requires Node >= 20, the floor @stellar/stellar-sdk needs and CI tests', () => {
    expect(pkg.engines).toEqual({ node: '>=20' });
  });

  it('declares "sideEffects": false — every module-level statement is a pure declaration', () => {
    expect(pkg.sideEffects).toBe(false);
  });

  it('points repository, bugs and homepage at the GitHub repo npm provenance validates', () => {
    const repository = pkg.repository as { type: string; url: string };
    const url = repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

    expect(repository.type).toBe('git');
    expect(url).toMatch(/^https:\/\/github\.com\/[\w.-]+\/trustflow-sdk$/);

    const bugs = pkg.bugs as { url: string };
    expect(bugs.url).toBe(`${url}/issues`);
    expect(pkg.homepage).toBe(`${url}#readme`);
  });

  it('declares an author and non-empty keywords', () => {
    expect(typeof pkg.author).toBe('string');
    expect((pkg.author as string).length).toBeGreaterThan(0);

    const keywords = pkg.keywords as string[];
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords.length).toBeGreaterThan(0);
    expect(new Set(keywords).size).toBe(keywords.length);
    expect(keywords).toContain('stellar');
    expect(keywords).toContain('soroban');
  });
});

describe('README badges', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const devDependencies = (pkg.devDependencies ?? {}) as Record<string, string>;

  it('advertises the TypeScript major that devDependencies actually pins', () => {
    const badge = readme.match(/badge\/TypeScript-([\d.]+)-blue\.svg/);
    expect(badge).not.toBeNull();

    const pinnedMajor = devDependencies.typescript.match(/^\D*(\d+)/)?.[1];
    expect(pinnedMajor).toBeDefined();
    expect(badge![1]).toBe(`${pinnedMajor}.0`);
  });

  it('advertises the license that package.json declares', () => {
    expect(readme).toContain('badge/License-MIT-yellow.svg');
  });
});
