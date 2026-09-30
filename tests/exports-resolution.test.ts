import * as fs from 'fs';
import * as path from 'path';

/**
 * #100 — every import path the README and examples show must resolve against
 * the published package's `exports` map, and every non-root subpath must be a
 * tsup build entry so `dist/<subpath>/index.*` actually gets built.
 */

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  name: string;
  exports: Record<string, Record<string, string>>;
};
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const tsup = fs.readFileSync(path.join(root, 'tsup.config.ts'), 'utf8');

function packageImportSpecifiers(source: string): string[] {
  const re = new RegExp(
    `from\\s+['"](${pkg.name.replace('/', '\\/')}(?:\\/[^'"]+)?)['"]`,
    'g',
  );
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

function specToSubpath(spec: string): string {
  return spec === pkg.name ? '.' : '.' + spec.slice(pkg.name.length);
}

describe('package exports map (#100)', () => {
  const exportKeys = Object.keys(pkg.exports);

  it('declares the documented non-root subpaths', () => {
    expect(exportKeys).toEqual(
      expect.arrayContaining(['.', './react', './escrow', './wallet', './utils']),
    );
  });

  it('every condition of every subpath is a valid condition pointing at a dist path', () => {
    for (const conditions of Object.values(pkg.exports)) {
      for (const [condition, target] of Object.entries(conditions)) {
        expect(['types', 'import', 'require']).toContain(condition);
        expect(target).toMatch(/^\.\/dist\/.+\.(d\.ts|mjs|js)$/);
      }
    }
  });

  it('every @trustflow/sdk import path in README.md resolves against the exports map', () => {
    const specs = packageImportSpecifiers(readme);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(exportKeys).toContain(specToSubpath(spec));
    }
  });

  it('every non-root subpath is wired as a tsup build entry', () => {
    const entryForSubpath: Record<string, string> = {
      './react': 'src/hooks/index.ts',
      './escrow': 'src/escrow/index.ts',
      './wallet': 'src/wallet/index.ts',
      './utils': 'src/utils/index.ts',
      './testing': 'src/testing/index.ts',
    };
    for (const [subpath, entry] of Object.entries(entryForSubpath)) {
      if (exportKeys.includes(subpath)) {
        expect(tsup).toContain(entry);
      }
    }
  });
});
