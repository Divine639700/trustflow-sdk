/**
 * Jest `setupFiles` polyfills.
 *
 * Runs inside the test environment (jsdom or node) before any test module is
 * loaded. `@stellar/stellar-sdk` reads `TextEncoder`/`TextDecoder` at import
 * time, but neither the jsdom nor the node Jest sandbox exposes them as globals,
 * so importing the SDK from a test (directly, or through
 * `tests/support/scval-matchers.ts`) fails with
 * `ReferenceError: TextEncoder is not defined`.
 *
 * Node has provided these globals since v11, so this only re-exposes what the
 * host runtime already has.
 */
import { TextDecoder, TextEncoder } from 'node:util';

const globals = globalThis as unknown as Record<string, unknown>;

if (typeof globals.TextEncoder === 'undefined') {
  globals.TextEncoder = TextEncoder;
}
if (typeof globals.TextDecoder === 'undefined') {
  globals.TextDecoder = TextDecoder;
}
