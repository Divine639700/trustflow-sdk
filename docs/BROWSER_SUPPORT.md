# Browser Support

Minimum supported versions for `@trustflow/sdk`:

| Browser | Minimum version | Notes |
| ------- | --------------- | ----- |
| Chrome / Chromium | 90+ | Full support |
| Edge (Chromium) | 90+ | Full support |
| Firefox | 88+ | Full support |
| Safari (macOS / iOS) | 14+ | Requires `Intl.RelativeTimeFormat` (Safari 14+) for `formatRelativeTime` |
| Node.js | 20+ | See `engines` in `package.json` |

The SDK targets `ES2022` (see `tsconfig.json`). `dist/index.mjs` (ESM) is
preferred for bundlers; `dist/index.js` (CJS) is available for older toolchains.

## Web APIs used

- `fetch` (via `axios` XHR fallback) — HTTP transport for backend/IPFS calls
- `BigInt` — stroop amounts, event payloads
- `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` — `formatDateTime` / `formatRelativeTime`
- `localStorage` — session persistence (browser); Node falls back to an
  in-memory adapter (see `configureSessionStorage()` for custom backends)
- `Buffer` (Node) — event XDR decoding uses `Buffer.from(xdr, 'base64')`;
  bundlers targeting browsers should polyfill `Buffer` (e.g. `buffer` package)

## Feature detection

Check for the APIs you use before calling them:

```typescript
if (typeof BigInt === 'undefined') {
  throw new Error('TrustFlow SDK requires BigInt support');
}

if (typeof Intl?.RelativeTimeFormat === 'undefined') {
  // formatRelativeTime() is unavailable — fall back to formatTimestamp()
}
```

## Polyfill requirements

- **BigInt**: no polyfill exists — upgrade the browser instead.
- **fetch**: all supported browsers ship it; very old WebViews may need
  `whatwg-fetch`.
- **Buffer**: only needed for `parseEvent`/`parseEvents` in the browser.
  With Vite/webpack 5 add the `buffer` package and alias `Buffer` globally;
 Rsbuild/Next.js do this automatically in most setups.
- **Intl.RelativeTimeFormat**: Safari < 14 needs a polyfill
  (`@formatjs/intl-relativetimeformat`) or use `formatTimestamp()` instead.

## Known issues

- React Native / Hermes: `BigInt` is supported on Hermes 0.70+; older
  versions must upgrade. `localStorage` does not exist — call
  `configureSessionStorage()` with an AsyncStorage-backed adapter.
- Server-side rendering: `localStorage` is absent during SSR — session
  helpers automatically use the in-memory adapter; no action needed unless
  you need cross-request persistence.

## Browser testing in CI

The `browser` CI job (`/.github/workflows/ci.yml`) runs the pure-utility
suites under a `jsdom` environment to catch usages of Node-only globals:

```bash
npx jest tests/utils-extended.test.ts --env=jsdom
```

Full end-to-end browser testing (Playwright/Cypress) is not yet wired up;
contributions welcome (see `CONTRIBUTING.md`).
