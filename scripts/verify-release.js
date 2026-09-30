/**
 * Pre-publish verification used by .github/workflows/release.yml.
 *
 * Usage: node scripts/verify-release.js [tag]
 *
 * Fails when the tag (if given), package.json version, SDK_VERSION and the
 * released CHANGELOG.md heading disagree, when the changelog's breaking-change
 * flag does not match the version bump (see scripts/release-policy.js), or
 * when `npm pack` would ship unexpected files or omit the LICENSE.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkBreakingChanges } = require('./release-policy');

const root = path.join(__dirname, '..');
const tag = process.argv[2];
const errors = [];

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (tag && tag !== `v${version}`) {
  errors.push(`tag ${tag} does not match package.json version v${version}`);
}

const constants = fs.readFileSync(path.join(root, 'src/constants.ts'), 'utf8');
const sdkVersion = (constants.match(/SDK_VERSION\s*=\s*'([^']+)'/) || [])[1];
if (sdkVersion !== version) {
  errors.push(`SDK_VERSION (${sdkVersion}) does not match package.json version (${version})`);
}

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (!new RegExp(`^## \\[${escaped}\\]`, 'm').test(changelog)) {
  errors.push(`CHANGELOG.md has no released heading for ${version}`);
}
errors.push(...checkBreakingChanges(changelog, version));

const [pack] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
  }),
);
const files = pack.files.map((f) => f.path);
const allowed = /^(dist\/|package\.json$|README(\.[a-z]+)?$|LICENSE(\.[a-z]+)?$)/i;
for (const file of files.filter((f) => !allowed.test(f))) {
  errors.push(`unexpected file in package: ${file}`);
}
if (!files.some((f) => /^LICENSE(\.[a-z]+)?$/i.test(f))) {
  errors.push('LICENSE is missing from the package');
}
if (!files.some((f) => f.startsWith('dist/'))) {
  errors.push('dist/ is missing from the package; run the build first');
}

if (errors.length > 0) {
  errors.forEach((e) => console.error(`error: ${e}`));
  process.exit(1);
}
console.log(`Release ${version} verified (${files.length} files in package).`);
