# Versioning and Breaking Change Policy

`@trustflow/sdk` follows [Semantic Versioning 2.0.0](https://semver.org/). This page says what a
version number promises, what counts as a breaking change, how APIs are deprecated and removed,
and how the changelog and upgrade guides are kept. The release mechanics (tagging, CI, npm
publish) are in [RELEASING.md](./RELEASING.md).

## Version numbers

Versions are `MAJOR.MINOR.PATCH`, with an optional pre-release suffix (`1.0.0-rc.1`).

| Bump | From 1.0.0 on | While on 0.x (today) |
|------|---------------|----------------------|
| **MAJOR** | Breaking changes | Reserved for the 1.0.0 release |
| **MINOR** | New, backwards-compatible features and deprecations | New features, deprecations **and breaking changes** |
| **PATCH** | Backwards-compatible bug fixes only | Backwards-compatible bug fixes only |

While the SDK is on `0.x` the public API is still settling, so breaking changes ship in **minor**
releases. They are never shipped in a patch release. That matches how npm resolves caret ranges:
`^0.2.1` accepts `0.2.x` but not `0.3.0`, so a caret range is safe on either side of 1.0.0.

Recommended ranges for consumers:

- `^X.Y.Z` — the default. Picks up fixes (and, from 1.0.0 on, features) without breaking changes.
- `~X.Y.Z` — patch fixes only.
- An exact version — when you want to review every update, for example in a wallet or
  custody product.

Pre-release versions (anything with a `-`) are published under the `next` npm dist-tag and are
never installed by a plain `npm install @trustflow/sdk`. They carry no compatibility promise
between each other.

`SDK_VERSION` (exported from the package root) always equals the `package.json` version and is
sent to the backend in the `X-SDK-Version` header.

## What is the public API

The compatibility promise covers what a consumer can reach through the documented entry points:

- Everything exported from `@trustflow/sdk` and its subpaths listed in `package.json` `exports`
  (`/react`, `/escrow`, `/wallet`, `/utils`, `/node`, `/testing`), including their **TypeScript
  types**.
- The shape of thrown errors: the `TrustFlowError` class and the meaning of each
  `TrustFlowErrorCode`.
- Persisted formats the SDK reads back: session storage keys and the versioned snapshots
  (`ACCOUNT_SNAPSHOT_VERSION`, `MULTISIG_SNAPSHOT_VERSION`).
- Supported runtimes: the Node.js range in `engines`, the browsers in
  [BROWSER_COMPATIBILITY.md](./BROWSER_COMPATIBILITY.md), and the `react` peer range.

Not covered: deep imports into `dist/`, anything not exported from an entry point, members marked
`@internal` or `@experimental` in their JSDoc, log message text, and the exact HTTP requests the
SDK makes to the backend.

## What is a breaking change

A change is breaking if code that compiled and worked against the previous version can stop
compiling, or behave differently, without the consumer changing anything. For example:

- Removing or renaming an export, a subpath entry, a class member, or a function parameter.
- Adding a **required** parameter or config field, or making an optional one required.
- Narrowing what a function accepts (a stricter type or stricter runtime validation that rejects
  input it used to accept).
- Changing a return type in a way callers can observe (a different shape, `T` to `T | undefined`,
  sync to async).
- Changing a default that alters behaviour, such as the network, retry policy, or a timeout.
- Removing a `TrustFlowErrorCode`, or throwing a different code for the same failure.
- Changing a persisted format so data written by the previous version no longer loads.
- Raising the minimum Node.js version, dropping a supported browser, or narrowing the `react` peer
  range.
- Upgrading `@stellar/stellar-sdk` across a major version when its types appear in this SDK's
  public API.
- Targeting a new version of the TrustFlow contracts that is not compatible with deployed ones.

Not breaking:

- New exports, new optional parameters or config fields, new methods.
- New `TrustFlowErrorCode` values. Handle unknown codes with a `default` branch rather than an
  exhaustive `switch`.
- Bug fixes that make behaviour match the documentation, even if someone relied on the bug. If a
  fix is likely to affect real integrations, it is called out in the changelog and may be held
  for the next breaking release.
- Deprecating an API (see below), internal refactors, performance work, and documentation.
- Changes to anything outside the public API as defined above.

When in doubt, treat the change as breaking.

## Deprecation policy

APIs are deprecated before they are removed, so an upgrade never removes something without
warning.

1. **Mark it.** Add a `@deprecated` JSDoc tag saying what to use instead, for example
   `/** @deprecated Pass a ContractConfig object instead. */`. Editors and TypeScript then show a
   strikethrough at every call site.
2. **Keep it working.** The deprecated API keeps its behaviour. Where it is cheap and not noisy,
   it may log once through the SDK logger; it never throws because it is deprecated.
3. **Announce it.** List it under `### Deprecated` in the changelog of the release that
   deprecates it, and add it to the table in [UPGRADING.md](./UPGRADING.md#current-deprecations).
4. **Remove it no earlier than:**
   - on `0.x`: the next minor release after the one that deprecated it, and not less than 30 days
     after that release;
   - from 1.0.0 on: the next major release.

   The removal is listed under `### ⚠️ Breaking Changes`, with the migration step in
   [UPGRADING.md](./UPGRADING.md).

Security fixes are the one exception: if an API cannot be made safe, it can be changed or removed
sooner. The release notes say so explicitly.

## Changelog maintenance

[CHANGELOG.md](../CHANGELOG.md) is the source of the GitHub Release notes: the release workflow
copies the section for the tagged version verbatim.

- **Every PR** that changes behaviour, the public API, or supported environments adds an entry
  under `## [Unreleased]`, referencing its issue (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
  Docs-only and test-only changes may skip it.
- **Group entries** under these headings, in this order, and leave out empty ones:
  `### ⚠️ Breaking Changes`, `### Added`, `### Changed`, `### Deprecated`, `### Removed`,
  `### Fixed`, `### Security`. Feature write-ups under their own `###` heading, as in the existing
  changelog, are fine for larger changes.
- **Breaking changes** go under `### ⚠️ Breaking Changes` and nowhere else, one bullet per change,
  each saying what broke and linking to its section in [UPGRADING.md](./UPGRADING.md).
- **At release time**, the `[Unreleased]` entries move under `## [X.Y.Z] - YYYY-MM-DD`
  ([RELEASING.md](./RELEASING.md), step 2).

### How breaking changes are flagged in releases

`scripts/verify-release.js` runs before every publish and fails the release when:

- the version's changelog section has a `### ⚠️ Breaking Changes` heading but the bump is not a
  breaking bump (a patch release, or a minor release from 1.0.0 on);
- a major release from 1.0.0 on has no `### ⚠️ Breaking Changes` heading;
- a section with that heading does not link to `docs/UPGRADING.md`.

Because the release notes are the changelog section, the heading also appears at the top of the
GitHub Release. In the PR itself, tick the "Breaking change" box in the template.

## Upgrade guides

[UPGRADING.md](./UPGRADING.md) has one section per breaking release (`0.x` minor, or major from
1.0.0 on), newest first. Each section lists every breaking change with:

- what changed and why;
- a before/after code snippet;
- how to find affected code (a type error, a search pattern, or a runtime error code).

The PR that introduces a breaking change writes its section in the same PR, so the guide is
complete by the time the release is cut.
