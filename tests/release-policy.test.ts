/**
 * The breaking-change rules `scripts/verify-release.js` enforces before a
 * publish (#239). The policy itself is documented in docs/VERSIONING.md.
 */

import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkBreakingChanges, isBreakingBump } = require('../scripts/release-policy') as {
  checkBreakingChanges: (changelog: string, version: string) => string[];
  isBreakingBump: (prev: string, next: string) => boolean;
};

const BREAKING = '### ⚠️ Breaking Changes\n- Removed `foo`. See [docs/UPGRADING.md](docs/UPGRADING.md).\n';

function changelog(sections: Array<[version: string, body: string]>): string {
  return ['# Changelog', '', '## [Unreleased]', '']
    .concat(sections.map(([version, body]) => `## [${version}] - 2026-01-01\n${body}`))
    .join('\n');
}

describe('isBreakingBump', () => {
  it.each([
    ['0.2.1', '0.3.0', true],
    ['0.2.1', '0.2.2', false],
    ['0.9.0', '1.0.0', true],
    ['1.2.3', '2.0.0', true],
    ['1.2.3', '1.3.0', false],
    ['1.2.3', '1.2.4', false],
    ['1.2.3', '2.0.0-rc.1', true],
  ])('%s -> %s is %s', (prev, next, expected) => {
    expect(isBreakingBump(prev, next)).toBe(expected);
  });
});

describe('checkBreakingChanges', () => {
  it('passes the repository CHANGELOG for the current version', () => {
    const root = path.resolve(__dirname, '..');
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    expect(checkBreakingChanges(text, version)).toEqual([]);
  });

  it('allows breaking changes in a 0.x minor release', () => {
    const text = changelog([['0.3.0', BREAKING], ['0.2.1', '- fix\n']]);
    expect(checkBreakingChanges(text, '0.3.0')).toEqual([]);
  });

  it('rejects breaking changes in a patch release', () => {
    const text = changelog([['0.2.2', BREAKING], ['0.2.1', '- fix\n']]);
    expect(checkBreakingChanges(text, '0.2.2')).toEqual([
      expect.stringContaining('is not a breaking version bump'),
    ]);
  });

  it('rejects breaking changes in a minor release from 1.0.0 on', () => {
    const text = changelog([['1.1.0', BREAKING], ['1.0.0', '- stable\n']]);
    expect(checkBreakingChanges(text, '1.1.0')).toEqual([
      expect.stringContaining('is not a breaking version bump'),
    ]);
  });

  it('requires a major release to flag its breaking changes', () => {
    const text = changelog([['2.0.0', '- new things\n'], ['1.4.0', '- stable\n']]);
    expect(checkBreakingChanges(text, '2.0.0')).toEqual([
      expect.stringContaining('has no "### ⚠️ Breaking Changes" heading'),
    ]);
  });

  it('requires flagged breaking changes to link the upgrade guide', () => {
    const text = changelog([['2.0.0', '### Breaking Changes\n- Removed `foo`.\n'], ['1.4.0', '- stable\n']]);
    expect(checkBreakingChanges(text, '2.0.0')).toEqual([
      expect.stringContaining('does not link to docs/UPGRADING.md'),
    ]);
  });

  it('does not compare a final release with its own pre-release', () => {
    const text = changelog([['1.0.0', '- ga\n'], ['1.0.0-rc.1', BREAKING], ['0.9.0', '- fix\n']]);
    expect(checkBreakingChanges(text, '1.0.0')).toEqual([]);
    expect(checkBreakingChanges(text, '1.0.0-rc.1')).toEqual([]);
  });

  it('skips the comparison for the first release', () => {
    expect(checkBreakingChanges(changelog([['0.1.0', '- initial\n']]), '0.1.0')).toEqual([]);
  });
});
