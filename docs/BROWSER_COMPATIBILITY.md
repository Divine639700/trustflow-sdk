# Browser & bundler compatibility

The TrustFlow SDK targets the web platform, not Node. This page is the
reference for two things that used to require guesswork:

1. **Which browsers the SDK runs in**, and what to do when WebCrypto is missing.
2. **Which bundlers build the SDK with zero configuration**, and why.

Everything here is enforced by tests — see
[Verification](#verification) at the bottom.

---

## 1. Runtime requirements

The SDK needs a small set of web-platform APIs. It does **not** bundle
polyfills for any of them, and it never installs one behind your back: a
missing capability produces a named, actionable error instead of a silent
downgrade.

| Capability | Required? | Why | If missing |
|---|---|---|---|
| `crypto.subtle` + `crypto.getRandomValues` | **Required** | Ed25519 key handling, signature verification, SHA-256 | `UNSUPPORTED_ENVIRONMENT` error naming WebCrypto |
| `Promise` | **Required** | Every async API | `UNSUPPORTED_ENVIRONMENT` error |
| `BigInt` | **Required** | Amounts in stroops exceed `Number.MAX_SAFE_INTEGER` | `UNSUPPORTED_ENVIRONMENT` error |
| `fetch` | Optional | `fetchAccountInfo` / `submitTransaction` | Those two helpers fail; the Stellar SDK transports still work |
| `localStorage` | Optional | Session persistence | `auth/session` falls back to process memory (see below) |
| `TextEncoder` | Optional | XDR string encoding | Contract helpers fail |

"Optional" means the *feature* degrades; it never means the SDK throws on
import. A read-only contract viewer never needs `localStorage`, and a Node-side
renderer never needs `crypto.subtle`.

### Supported browsers

| Browser | Minimum | Notes |
|---|---|---|
| Chrome / Edge | 49 | `crypto.subtle` needs a secure context (HTTPS or `localhost`) |
| Firefox | 52 | Same secure-context rule |
| Safari | **15.4** | Below this, `crypto.subtle` is absent — see below |
| iOS Safari | 15.4 | Matches Safari |
| Node | 20+ | `crypto.webcrypto` is exposed as `globalThis.crypto` from Node 19 |
| Deno / Bun | current | Web-standard globals |
| Service workers | Chrome/Edge/Firefox | Read-only use; no DOM APIs are touched |

Safari below 15.4 and **any page served over plain `http://`** (rather than
HTTPS) expose `crypto.getRandomValues` but hide `crypto.subtle`, because
WebCrypto's subtle interface is restricted to secure contexts. That is the
single most common "it works on localhost but fails in staging" cause.

---

## 2. Detecting WebCrypto

### At startup

```typescript
import { detectFeatures, assertWebCryptoSupport } from '@trustflow/sdk';

// Never throws, never polyfills — safe in SSR, a worker, or a test.
const report = detectFeatures();
if (!report.supported) {
  for (const feature of report.missing) {
    console.error(`${feature.label}: ${feature.reason}`);
  }
}

// Throws TrustFlowError with code UNSUPPORTED_ENVIRONMENT, naming the API.
assertWebCryptoSupport('signing an auth challenge');
```

`client.getEnvironment()` returns the same report bound to a client instance.

### At the point of use

Feature-detect lazily, right where the crypto happens, so the error names the
operation that failed:

```typescript
import { assertWebCryptoSupport } from '@trustflow/sdk';

export async function signChallenge(challenge: string, wallet: Wallet) {
  assertWebCryptoSupport('signing an auth challenge');
  return wallet.sign(challenge);
}
```

### The error you will see

```
TrustFlowError: signing an auth challenge requires the WebCrypto API, which is
unavailable here: crypto.subtle is missing (insecure context — WebCrypto is only
exposed over HTTPS or on http://localhost). Serve the page over HTTPS, upgrade to
a browser with WebCrypto (Chrome 49+, Firefox 52+, Safari 15.4+), or install a
WebCrypto polyfill before initialising the SDK.
```

`err.code === 'UNSUPPORTED_ENVIRONMENT'`, so it can be handled
programmatically rather than by matching on the message.

### Polyfills

If you must support Safari 15.3 or an insecure context, load a WebCrypto
polyfill **before** the SDK does any work. This is an application-level choice,
not something the SDK makes for you:

```html
<script src="https://unpkg.com/polyfill-cryptojs"></script>
<script type="module">
  // Loaded above, so the SDK sees a complete crypto.subtle.
  import { TrustFlowClient } from '@trustflow/sdk';
</script>
```

Note that a polyfill cannot retroactively fix an *insecure context*: browsers
refuse to expose `crypto.subtle` over plain `http://` precisely to stop
downgrade attacks. Serving the page over HTTPS is the only real fix there.

### SSR / bundler caveat

`detectFeatures()` and `assertWebCryptoSupport()` are safe to call during
server-side rendering: they only read globals and never throw unless a required
capability is genuinely absent. The `assert*` helpers are the ones to guard with
a `typeof window !== 'undefined'` check when you only want to enforce the
requirement in the browser:

```typescript
if (typeof window !== 'undefined') assertWebCryptoSupport('client bootstrap');
```

### `auth/session` without `localStorage`

`auth/session.ts` uses `localStorage` when it exists and an in-memory store
otherwise. In Node, and in a browser with storage disabled, a session therefore
lives only for the lifetime of the process/page. Supply your own adapter for
durability — see [Session Storage (Browser vs Node)](https://github.com/trustflow-protocol/trustflow-sdk#session-storage-browser-vs-node).

---

## 3. Bundlers

**The SDK's browser entries require no Node polyfill configuration.** No
`resolve.fallback`, no `ProvidePlugin`, no `node:` alias, no `inject`, no
`Buffer`/`process`/`stream` shims.

| Bundler | Config needed for the SDK | Status |
|---|---|---|
| **Webpack 5** | none | Verified |
| **Rollup 4** | `@rollup/plugin-commonjs` — required by `@stellar/stellar-sdk`, *not* the SDK, and not a polyfill | Verified |
| **esbuild** | none (`platform: 'browser'`) | Verified |
| **Vite** | none (Vite is esbuild + Rollup internally; the Rollup note applies) | Works |
| **Next.js** | none | Works |
| **Browserify / Parcel 1** | — | Not supported; both predate ESM-only packages |

### Why Rollup needs `commonjs`

`@stellar/stellar-sdk` ships its browser build as a **UMD** bundle
(`module.exports = factory()`), not ESM. A strict-ESM bundler cannot take named
imports from a UMD module, so `@rollup/plugin-commonjs` is needed to interop it.
The SDK's own sources and every `@trustflow/sdk` entry point are ESM.

This is a property of the Stellar SDK, not of TrustFlow, and `@rollup/plugin-commonjs`
is not a Node polyfill: it converts CommonJS modules, and adds no shims for
`Buffer`, `process`, `stream` or `crypto`.

```js
// rollup.config.mjs
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/main.ts',
  plugins: [nodeResolve({ browser: true }), commonjs()],
};
```

### Webpack 5

Nothing to add. A Webpack 5 project resolves the SDK and builds:

```js
// webpack.config.js
module.exports = { mode: 'production', entry: './src/main.js' };
```

If you *do* see
`BREAKING_CHANGE: webpack < 5 used to include polyfills for node.js core modules by default`,
something in your dependency graph — not the SDK's browser entries — reached a
Node built-in. The
[`NoNodeBuiltinsPlugin`](https://github.com/trustflow-protocol/trustflow-sdk/blob/main/examples/bundlers/webpack5/webpack.config.js)
in the example project turns that into a precise error instead of a shim.

### Entry points

| Import | Contents | Node built-ins |
|---|---|---|
| `@trustflow/sdk` | Everything below, plus the client and all sub-clients | None |
| `@trustflow/sdk/react` | React hooks (`'use client'`) | None |
| `@trustflow/sdk/escrow` | `TrustFlowEscrowClient`, `EscrowBuilder`, multisig, dispute | None |
| `@trustflow/sdk/wallet` | Freighter / Albedo adapters, `signWithFreighter` | None |
| `@trustflow/sdk/utils` | Retry, HTTP, validation, feature detection | None |
| `@trustflow/sdk/node` | **Node only** — `createHttpAgent`, `createHttpsAgent`, `configureAxiosConnectionPool` | `node:http`, `node:https` |

`@trustflow/sdk/node` is the only entry that touches Node's `http`/`https`. It
exists so the browser bundle never has to, even by accident — see
`src/node/agents.ts` for the reasoning. Importing it in a browser is a mistake:
the browser manages its own per-origin connection pool and the agents have no
meaning there.

The root entry re-exports the *environment-agnostic* half of the pooling API
(`PoolConfig`, `PoolStats`, `getHttpAgentStats`, `monitorPoolHealth`,
`destroyPoolAgent`), which is safe everywhere.

---

## 4. Common problems

| Symptom | Cause | Fix |
|---|---|---|
| `crypto.subtle is undefined` on staging, works on `localhost` | Insecure context | Serve over HTTPS, or use `localhost` |
| `UNSUPPORTED_ENVIRONMENT: ... BigInt` | Browser pre-ES2020 | Upgrade; `BigInt` cannot be polyfilled meaningfully |
| `BREAKING_CHANGE: webpack < 5 used to include polyfills` | A transitive dep reached a Node built-in | Check `NoNodeBuiltinsPlugin` output; the SDK's own entries are clean |
| `"default" is not exported by "is-retry-allowed"` (old SDK versions) | `axios-retry` was CommonJS-only | Upgrade — the SDK no longer depends on `axios-retry` |
| `Response.json is not a function` under a test runner | A test `fetch` stub that only implements `text` | `fetchAccountInfo` parses JSON; stub it accordingly |
| Session vanishes on refresh in Node/SSR | No `localStorage` | Use `configureSessionStorage()` with a durable adapter |

---

## 5. Verification

Both claims on this page are enforced, not asserted:

```bash
npm run build          # the examples consume the real dist/ via the exports map
npm run test:bundlers  # Webpack 5, Rollup and esbuild, then scan for Node built-ins
npm test               # includes tests/environment.test.ts and tests/bundler-compat.test.ts
```

`npm run test:bundlers` fails if any bundler cannot build the shared example
entry, or if a Node core module specifier appears in a produced bundle. The
shared entry
([`examples/bundlers/shared-entry.ts`](https://github.com/trustflow-protocol/trustflow-sdk/blob/main/examples/bundlers/shared-entry.ts))
deliberately touches every browser entry point, so a regression that
reintroduced a Node-only import would fail the check rather than waiting to be
reported by a user.

[`tests/bundler-compat.test.ts`](https://github.com/trustflow-protocol/trustflow-sdk/blob/main/tests/bundler-compat.test.ts)
additionally asserts statically that no module reachable from the root, `/escrow`,
`/wallet`, `/react` or `/utils` entries imports a Node built-in.
