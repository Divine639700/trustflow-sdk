# Releasing

Releases are published by `.github/workflows/release.yml` when a `vX.Y.Z` tag is pushed. Which version number to pick, and what counts as a breaking change, is defined in [VERSIONING.md](./VERSIONING.md).

1. Bump `version` in `package.json` and `SDK_VERSION` in `src/constants.ts` to the new version.
2. In `CHANGELOG.md`, move the `[Unreleased]` entries under a new `## [X.Y.Z] - YYYY-MM-DD` heading. If the release contains breaking changes, they must be under a `### ⚠️ Breaking Changes` heading that links to [UPGRADING.md](./UPGRADING.md), and the version must be a breaking bump (minor on `0.x`, major from 1.0.0 on).
3. Merge to `main` once CI is green, then tag that commit and push the tag:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
4. The `verify` job runs `npm ci`, typecheck, lint, tests and build, then `scripts/verify-release.js`, which fails if the tag, `package.json`, `SDK_VERSION` and the changelog heading disagree, if the breaking-change flag in the changelog does not match the version bump (see [VERSIONING.md](./VERSIONING.md#how-breaking-changes-are-flagged-in-releases)), if `npm pack` would ship files outside `dist`, README, LICENSE and `package.json`, or if `LICENSE` is missing. It ends with `npm publish --dry-run`.
5. The `publish` job is the only one with `id-token: write`. It waits for a reviewer to approve the protected `npm-release` environment, publishes with `npm publish --provenance --access public`, and creates the GitHub Release using the matching changelog section as notes. Versions containing `-` are published under the `next` dist-tag and marked as pre-releases.

## Dry run
Run the workflow manually (Actions, Release, Run workflow) with `dry-run` enabled. Every verification step runs; nothing is published and no release is created. A dry run without a tag skips the tag comparison.

## One-time setup
- Create the `npm-release` environment with required reviewers.
- Add an `NPM_TOKEN` secret to it (or configure npm trusted publishing for the package).
