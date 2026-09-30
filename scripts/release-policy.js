/**
 * Breaking-change checks for a release, used by scripts/verify-release.js.
 * The policy they enforce is documented in docs/VERSIONING.md.
 *
 * - A changelog section with a `### ⚠️ Breaking Changes` heading must be a
 *   breaking version bump: a major bump from 1.0.0 on, a minor (or major)
 *   bump while the SDK is on 0.x. Breaking changes never ship in a patch.
 * - A major bump from 1.0.0 on must have that heading.
 * - A section with that heading must link to docs/UPGRADING.md, where the
 *   migration steps live.
 */

const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\][^\n]*$/gm;
const BREAKING_HEADING = /^###\s+(?:⚠️\s*)?Breaking Changes\s*$/im;

function parseCore(version) {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  return { major, minor, patch };
}

/** Released versions in the order their headings appear in CHANGELOG.md, with each section's text. */
function releasedSections(changelog) {
  const headings = [...changelog.matchAll(RELEASE_HEADING)];
  return headings.map((match, i) => {
    const end = i + 1 < headings.length ? headings[i + 1].index : changelog.length;
    return { version: match[1], body: changelog.slice(match.index, end) };
  });
}

/** Whether moving from `prev` to `next` is allowed to contain breaking changes. */
function isBreakingBump(prev, next) {
  const a = parseCore(prev);
  const b = parseCore(next);
  if (b.major !== a.major) return true;
  return a.major === 0 && b.minor !== a.minor;
}

/** Returns a list of policy violations for `version`; empty when it complies. */
function checkBreakingChanges(changelog, version) {
  const sections = releasedSections(changelog);
  const index = sections.findIndex((s) => s.version === version);
  if (index === -1) return [];

  const { body } = sections[index];
  const flagged = BREAKING_HEADING.test(body);
  const errors = [];

  if (flagged && !/UPGRADING\.md/.test(body)) {
    errors.push(`CHANGELOG.md section for ${version} lists breaking changes but does not link to docs/UPGRADING.md`);
  }

  const previous = sections[index + 1];
  if (!previous) return errors;

  const prev = parseCore(previous.version);
  const next = parseCore(version);
  const sameCore = prev.major === next.major && prev.minor === next.minor && prev.patch === next.patch;
  if (sameCore) return errors;

  if (flagged && !isBreakingBump(previous.version, version)) {
    errors.push(
      `CHANGELOG.md section for ${version} lists breaking changes, but ${previous.version} -> ${version} ` +
        `is not a breaking version bump (see docs/VERSIONING.md)`,
    );
  }
  if (!flagged && next.major >= 1 && next.major !== prev.major) {
    errors.push(`${version} is a major release but its CHANGELOG.md section has no "### ⚠️ Breaking Changes" heading`);
  }
  return errors;
}

module.exports = { checkBreakingChanges, isBreakingBump, releasedSections };
