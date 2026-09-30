# Spike: Freighter integration contract and adapter approach

Tracking issue: [#312](https://github.com/trustflow-protocol/trustflow-sdk/issues/312)

**Status: partial.** Everything below marked **[source]** was verified by reading the published
`@stellar/freighter-api` packages (npm tarballs of 1.7.1, 2.0.0, 3.1.0, 4.1.0, 5.0.0 and 6.0.1) and
`@creit.tech/stellar-wallets-kit@2.7.0`, plus this repository's code. Everything marked **[live]**
needs a real browser with the Freighter extension installed and was **not** run for this document:
no extension was installed, no screenshots or console output were captured, and no testnet
transaction was signed. The issue's first task and its first acceptance criterion ("works against the
real extension, with evidence") therefore remain open; section 6 lists the exact live checks.

## 1. What the SDK assumes today [source: this repo]

`src/wallet/freighter.ts` reads `window.freighter` and calls three methods on it:

| Call | Used by |
|---|---|
| `getPublicKey(): Promise<string>` | `connectWallet` (`src/wallet/connect.ts`) |
| `getNetwork(): Promise<string>` | `connectWallet`, `signWithFreighter` |
| `signTransaction(xdr, { network }): Promise<{ signedXDR }>` | `signWithFreighter` (`src/stellar/signing.ts`) |

`isFreighterInstalled()` waits a fixed 100 ms and returns `!!window.freighter`. `tests/wallet.test.ts`
and `tests/signing.test.ts` install a hand-written `window.freighter` with the same shape, so they
prove nothing about the real extension.

## 2. What the official package does [source: `@stellar/freighter-api` 6.0.1]

- **`window.freighter` is a detection flag, not an API object.** `isConnected()` starts with
  `if (window.freighter) return { isConnected: window.freighter }`, i.e. it forwards the value as a
  boolean. Nothing in the package ever calls a method on `window.freighter`. (Whether the extension
  sets it to exactly `true` is **[live]**.)
- **All wallet calls go through `window.postMessage`.** Requests are posted as
  `{ source: "FREIGHTER_EXTERNAL_MSG_REQUEST", messageId, ...payload }` to `window.location.origin`;
  replies come back as `FREIGHTER_EXTERNAL_MSG_RESPONSE` messages. There is no injected object to call.
- **Timeout in detection.** For the connection-status and public-key requests the package gives up
  after 2000 ms and resolves `{ isConnected: false, publicKey: "" }`. The SDK's fixed 100 ms wait is
  shorter than the vendor's own detection window; whether the flag is present within 100 ms of page
  load is **[live]**.
- **Node/SSR.** Every function checks `typeof window !== "undefined"` and otherwise returns an
  `error: { code: -1, message: "Node environment is not supported" }` result.

### Method names and result shapes by major version [source]

| Major | Public key | Sign transaction | Network | Errors |
|---|---|---|---|---|
| 1.x, 2.x | `getPublicKey(): Promise<string>` | `signTransaction(xdr, { network?, networkPassphrase?, accountToSign? }): Promise<string>` (the signed XDR) | `getNetwork(): Promise<string>` | thrown |
| 3.x to 6.x | `getAddress()` and `requestAccess()`: `{ address, error? }` | `signTransaction(xdr, { networkPassphrase?, address? }): { signedTxXdr, signerAddress, error? }` | `getNetwork(): { network, networkPassphrase, error? }`; `getNetworkDetails()` adds `networkUrl`, `sorobanRpcUrl` | returned in `error: { code, message, ext? }`, not thrown |

Also present from 3.x: `signMessage(message, opts?)` (result `{ signedMessage, signerAddress, error? }`;
`signedMessage` is a `Buffer` in the v3-style response and a `string` in the v4-style response, both
typed in 6.0.1), `signAuthEntry`, `isAllowed`, `setAllowed`, `addToken`, `WatchWalletChanges`.

Consequences for the current SDK code:

1. `getPublicKey` does not exist in 3.x to 6.x (renamed `getAddress`), and a separate `requestAccess()`
   was added; which of the two should drive the connect flow is **[live]**.
2. `signTransaction` returns `{ signedTxXdr, signerAddress }`, not `{ signedXDR }`. With the SDK's
   shape, `signWithFreighter` would destructure `undefined`. After the #292 hardening this fails
   loudly as `SIGNING_ERROR` (unparseable envelope) instead of returning `undefined`.
3. The option is `networkPassphrase`, not `network`; the extension does not take the SDK's
   `'TESTNET' | 'MAINNET'`.
4. Errors are returned, not thrown, from 3.x on. Code that only `try/catch`es would treat a rejection
   as success.

**Conclusion from source: the current `window.freighter` contract does not match the package that
is the documented way to drive Freighter, so `connectWallet('freighter')` and `signWithFreighter`
are expected to fail against a real install even though all mocked tests pass.** This is an
inference from the client package; confirming what the extension itself exposes on `window` and
end-to-end behaviour is **[live]**.

## 3. Network names and passphrases

- **[source]** 3.x to 6.x return both `network` and `networkPassphrase` from `getNetwork()` and accept
  `networkPassphrase` on `signTransaction`/`signMessage`. The SDK's `Network` is only a label; the
  authoritative values are the passphrases in `NETWORK_CONFIGS` (`src/stellar/network.ts`).
- **Recommendation:** the adapter contract should carry the passphrase, not the label, and compare
  the wallet's `networkPassphrase` with the transaction's. Use `NETWORK_CONFIGS[network].passphrase`
  to translate. The exact `network` strings the extension reports (`PUBLIC` versus `MAINNET`,
  `FUTURENET`, custom networks) are **[live]**; `signWithFreighter` currently normalizes only
  `PUBLIC` to `MAINNET` and should move to passphrase comparison in the adapter.

## 4. User rejection and locked wallet [source, values pending live run]

- **[source]** 3.x to 6.x report failures as `error: { code: number; message: string; ext?: string[] }`
  on the result. The package defines dedicated declined and internal-error values
  (`FreighterApiDeclinedError`, `FreighterApiInternalError`; the internal one is
  `{ code: -1, message: "The wallet encountered an internal error. Please try again or contact the wallet if the problem persists." }`).
  The declined error's numeric code and message are declared in a shared module that is not part of
  the published tarball, so they are **[live]**, as is what a locked wallet returns.
- **Mapping to record once observed:** user declined and any other wallet-side `error` map to
  `SIGNING_ERROR` with the wallet's error as `cause` (as `signWithFreighter` now does for thrown
  rejections); a missing extension stays `UNAUTHORIZED`. Cross-reference #292.

## 5. Options compared

| Option | Bundle / dependency | SSR | Version drift | Testability | Verdict |
|---|---|---|---|---|---|
| (a) Keep the `window.freighter` contract | none | safe | contract is invented, already drifted | mocks cannot detect mismatch | **Reject.** Contradicted by section 2 |
| (b) Depend on `@stellar/freighter-api` directly, call it from wallet code | small: 2 deps (`buffer`, `semver`) | package returns `-1` errors under Node | 6 majors with changed method names and result shapes; pin a range | mock the module, but SDK logic is welded to one wallet | Acceptable only as part of (c) |
| (c) `WalletAdapter` (`src/wallet/types.ts`) is the SDK contract; ship a Freighter adapter on `@stellar/freighter-api` as an **optional peer dependency** | none for non-Freighter users | adapter lazily imports the package, guarded by `typeof window` | drift isolated to one file, tested against real types | adapter tests use the package's real types, a shared contract test runs any adapter | **Recommended** |
| (d) Adopt Stellar Wallets Kit | `@creit.tech/stellar-wallets-kit@2.7.0` lists 19 direct dependencies (WalletConnect, Reown, Ledger, Trezor, Preact, ...) and `@stellar/stellar-sdk ^17` against this SDK's `^15.1.0` | brings its own UI; needs guarding | inherits `@stellar/freighter-api@6.0.0` plus every other wallet's drift | harder to stub | **Reject for now**; revisit if multi-wallet UI becomes a product goal |

### Recommended adapter contract

Extend the existing interface rather than inventing a new one:

```ts
interface WalletAdapter {
  type: WalletType;
  isAvailable(): Promise<boolean>;
  connect(): Promise<WalletConnection>;           // requestAccess() then network details
  sign(xdr: string, networkPassphrase: string): Promise<{ signedXdr: string; signerAddress: string }>;
  signMessage?(message: string): Promise<{ signedMessage: string; signerAddress: string }>; // backend login challenge (#297)
  disconnect(): Promise<void>;
}
```

- Wallet errors are normalized inside the adapter to `TrustFlowError` (`SIGNING_ERROR` for
  rejection/failure, `UNAUTHORIZED` for a missing wallet) with the original error as `cause`.
- `signWithFreighter`-style verification (same hash, added signature, expected signer) stays
  adapter-independent, as implemented for #292.
- `WalletType` should only list adapters that exist; `'albedo' | 'xbull' | 'manual'` are declared but
  `connectWallet` supports none of them.

### Testing without hiding mismatches

1. Type the Freighter adapter against `@stellar/freighter-api`'s exported functions so a renamed
   method or changed result fails `tsc`, not production.
2. Mock at the package boundary with objects returned in the package's real result shape
   (`{ signedTxXdr, signerAddress }`, `{ error: { code, message } }`), not a made-up `window` object.
3. Keep one adapter contract test suite that every adapter (including a fake in-memory one) must
   pass, and one manual/E2E checklist (section 6) run against a real extension before a release that
   touches wallet code.

## 6. Live verification still required

Run in Chrome with the current Freighter extension on testnet, and record versions and console output:

1. `window.freighter` value/type and when it appears after load (does 100 ms hold?).
2. What `connectWallet('freighter')` does (expected: `getPublicKey is not a function`).
3. What `signWithFreighter` does against a funded testnet account.
4. Reported `network` strings for testnet and mainnet.
5. Exact `error.code` / `error.message` for user decline, locked wallet, and wrong network.
6. `signMessage` behaviour for an auth challenge (#297).

## 7. Proposed follow-up issues (sizing)

| Follow-up | Estimate |
|---|---|
| Freighter adapter on `@stellar/freighter-api` (optional peer dep), replace `window.freighter` in `connectWallet`/`signWithFreighter`/`useWallet`, passphrase-based network check | 2 days |
| `signMessage` support on the adapter and wire it to the backend login challenge (#297) | 1 day |
| Adapter contract test suite plus package-typed mocks; migrate `tests/wallet.test.ts` and `tests/signing.test.ts` | 1 day |
| Update README/QUICKSTART/API docs and `examples/` that call `connectWallet('freighter')`; prune unsupported `WalletType` members | 0.5 day |
| Manual E2E checklist (section 6) run and recorded, including error-shape table | 0.5 day |
