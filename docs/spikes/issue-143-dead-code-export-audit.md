# Spike: reachability audit of `src/` from the package root

Tracking issue: [#143](https://github.com/trustflow-protocol/trustflow-sdk/issues/143)

Scope: this audit answers, module by module, the question from the batch filed in
`fix.md`: *"is this dead code to delete, or a real feature that should be exported
and documented?"* It enumerates every exported symbol in `src/`, traces reachability
from the public entrypoint `src/index.ts`, and records a disposition (delete vs
export + document) for everything unreachable.

> **Baseline caveat.** The issue was filed against an earlier snapshot. Since then
> several companion issues have already landed:
> - **#80** (shadowed `types/index` exports) — fixed: `src/index.ts` now explicitly
>   re-exports `./types/index` (comment at `src/index.ts:8`).
> - **#45** (schemas not exported) — partially done: schema objects + `*Input` types
>   are re-exported by name from root; `parseRpcResponse` remains internal-only.
> - **#81** (hooks not exported from root) — resolved by *design decision*, not code:
>   hooks ship via the `@trustflow/sdk/react` subpath export, not the root.
> - `src/stellar/rpc.ts` — already deleted (see `CHANGELOG.md` and spike
>   `issue-79-retry-session-multisig.md`).
> - Some filenames cited in the issue no longer exist: `src/utils.ts` is now the
>   `src/utils/` directory, `src/utils/cache.ts` / `src/utils/validate.ts` /
>   `src/stellar/horizon.ts` have no current counterpart. `errors.ts`'s
>   `TrustFlowError` is now exported from the root (`src/index.ts:27`).

## 1. Reachable from `src/index.ts` (no action)

These are the package's public API surface (directly re-exported, or transitively
through a barrel that the root re-exports). No change needed.

| Module | Re-exported from root |
|---|---|
| `types.ts` | `export *` (line 1) |
| `types/index`, `types/contract`, `types/events`, `types/multisig`, `types/juror`, `types/profile` | `export *` (lines 8–13) |
| `constants` | line 14 |
| `escrow` (client, builder, monitor, dispute, multisig, `createEscrow`, `releaseEscrow`, `cancelEscrow`, `getEscrow`) | line 15 |
| `juror`, `profile`, `storage` (IPFS), `auth`, `stellar`, `tx-pipeline`, `contract` | lines 16–25 |
| `utils/validation`, `utils/format`, `utils/i128` | lines 21–23 |
| `client` (`TrustFlowClient`) | line 26 |
| `errors` (`TrustFlowError`, `TrustFlowErrorCode`) | line 27 |
| `schemas` (schema objects + `*Input` types) | lines 33–43 |

**Disposition:** keep. Already reachable. **#80 closed as done, #45 (types portion)
done.**

## 2. Unreachable from the root — but shipped via subpath export (no action)

These directories are deliberate, separate entry points. They are *not* reachable
from `src/index.ts` by design, and are documented + shipped via package `exports`
subpaths. Removing or forcibly re-exporting them would be a breaking/architectural
change.

| Directory/entry | Subpath | Status |
|---|---|---|
| `src/hooks/*` (`useWallet`, `useBalance`, `useTransaction`, `useEscrow`) | `@trustflow/sdk/react` | **export + document (done via subpath)** — closes **#81** |
| `src/wallet/*` (`getFreighter`, `isFreighterInstalled`, `getAlbedo`, `connectWallet`, `disconnectWallet`, `WalletType`, `WalletConnection`, `WalletAdapter`) | `@trustflow/sdk/wallet` | export + document (done via subpath) |
| `src/utils/index` barrel (`retry`, `logger`, `http`, re-exports) | `@trustflow/sdk/utils` | export + document (done via subpath) |

`src/utils/retry.ts` (`retry`) specifically: a generic public utility with its own
unit tests (`tests/retry.test.ts`). **Keep** — documented public API, not dead code.
Same rationale already recorded in spike `issue-79`.

**Disposition:** keep as subpath exports. **#81 closed as done (react subpath).**

## 3. Unreachable from root AND unreachable from any subpath — needs a decision

These are genuinely unreachable from **every** package entry point (not imported by
any shipped file). Each needs an explicit delete-or-export decision.

| File / symbol | Disposition | Rationale |
|---|---|---|
| `src/events.ts` (`TrustFlowEventType`, `RawContractEvent`, `ParsedEvent`, `EscrowCreatedData`, `EscrowReleasedData`, `DisputeRaisedData`, `isTrustFlowEvent`, `parseEvent`, `parseEvents`) | **export + document** | Real feature (contract-event parsing, `#40`-era work) that is fully implemented but never wired to any entry point. It has no tests, but it's a legitimately useful utility that overlaps with the shipped `types/events` type (different shape). Recommend: add to the package (e.g. a `@trustflow/sdk/events` subpath or root re-export) + document + add tests. Do **not** delete. |
| `src/stellar/signing.ts` (`SignableTransaction`, `SignedTransaction`, `signWithFreighter`) | **export + document** | Real signing feature that complements `wallet/` and `stellar/transaction`. Unreachable via every entry point (not in `stellar/index` barrel). Imports `wallet/freighter`. Recommend: include in the `./wallet` subpath (it is wallet-adjacent) + document + tests. |
| `src/utils/http.ts` (`createApiHttpClient`, `toApiErrorMessage`) | **keep as internal (not public)** | Transitively reachable — used by many shipped files (escrow, dispute, storage, profile, auth). Not dead code, but its symbols are not part of the public API and should stay un-exported from root. No change. |
| `src/utils/logger.ts` (`SDKLogger`, `logger`) | **keep as internal (not public)** | Transitively reachable via the `logger` singleton used by monitor/dispute. `SDKLogger` class itself is only referenced through that singleton. No change. |

## 4. Disposition summary

| Symbol / module | Disposition |
|---|---|
| `errors` / `TrustFlowError` | already exported — **done** |
| `types/index` shaded exports | already fixed — **done (#80)** |
| `schemas` objects + `*Input` | already exported — **done (#45)** |
| `hooks/*` | **export + document — done via `./react` subpath (#81)** |
| `wallet/*`, `utils/*` barrels | export + document — done via `./wallet` / `./utils` subpaths |
| `utils/retry` | keep (public utility with tests) |
| `utils/http`, `utils/logger` | keep internal (transitively reachable, not public API) |
| `src/events.ts` | **export + document (new subpath or root) + tests** |
| `src/stellar/signing.ts` | **export + document (add to `./wallet` subpath) + tests** |
| nothing left to delete | `stellar/rpc.ts` already removed in an earlier PR; no other file is both dead and unimplemented |

## 5. Recommended follow-up issues

Only two symbols are "a real feature that should be exported and documented" but are
currently stranded with no entry point at all. Everything else is either already
handled or intentionally internal/subpath.

- **SDK: expose `src/events.ts` event-parsing utilities** through the package (root or a
  `@trustflow/sdk/events` subpath), document them, and add unit tests. Currently
  implemented (`parseEvent`/`parseEvents`/types) but unreachable from every entry point.
- **SDK: expose `stellar/signing.ts` (`signWithFreighter` + types)** via the `./wallet`
  subpath, document, and add tests. It is the missing wallet-adjacent signing piece and
  is currently unreachable from every entry point.
- Close **#80**, **#81**, and the **#45** export portion as done (already landed).

## 6. Verification

- Grep across `src/`, `tests/`, `examples/` (if any), `README.md`, `docs/` confirms
  `events.ts`, `stellar/signing.ts`, `stellar/rpc.ts` are referenced only in their own
  files/docs — they are not re-exported from any entry-point barrel.
- `package.json` `exports` confirms `./react`, `./wallet`, `./utils` subpaths are the
  only entry points, so subpath-only directories are intentionally separate from the root.
