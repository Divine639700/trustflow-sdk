import { TrustFlowError } from '../errors';

/**
 * Runtime capability detection for the environments the SDK runs in.
 *
 * The SDK does not require Node, and it does not bundle polyfills for it. What
 * it does require is a small set of *web* platform APIs. This module detects
 * them, reports exactly which ones are missing, and raises a
 * `TrustFlowError` with code `UNSUPPORTED_ENVIRONMENT` naming the gap — so a
 * browser without WebCrypto (Safari < 15.4, or any page served over plain
 * `http://`, where `crypto.subtle` is absent) fails with an actionable message
 * instead of a bare `ReferenceError: crypto is not defined` or a silently
 * skipped signature.
 *
 * See `docs/BROWSER_COMPATIBILITY.md` for the full support matrix.
 */

/** A single capability and whether this runtime provides it. */
export interface FeatureSupport {
  /** Stable identifier, e.g. `'webcrypto'`. */
  readonly name: string;
  /** Human-readable name for error messages. */
  readonly label: string;
  /** Whether the capability is usable right now. */
  readonly supported: boolean;
  /**
   * Why it is unavailable, and what to do about it. `undefined` when
   * {@link FeatureSupport.supported} is `true`.
   */
  readonly reason?: string;
  /** URL with more detail, included in error messages. */
  readonly docs?: string;
}

/** Aggregated result of {@link detectFeatures}. */
export interface EnvironmentReport {
  /** `'browser'`, `'node'`, `'worker'` or `'unknown'`. */
  readonly runtime: 'browser' | 'node' | 'worker' | 'unknown';
  /** Whether the SDK's baseline web-platform requirements are met. */
  readonly supported: boolean;
  /** Per-capability detail, in the order they were checked. */
  readonly features: readonly FeatureSupport[];
  /** Capabilities that are missing, described for a human. */
  readonly missing: readonly FeatureSupport[];
}

/** Where the SDK is executing, derived from globals rather than user agent sniffing. */
export type RuntimeKind = EnvironmentReport['runtime'];

/** Baseline capabilities every TrustFlow call path needs. */
export const REQUIRED_FEATURES = ['webcrypto', 'promise', 'bigint'] as const;

/**
 * Capabilities only some call paths need. An SDK used purely as a read-only
 * contract viewer never touches these, so their absence is reported but does
 * not mark the environment unsupported.
 */
export const OPTIONAL_FEATURES = [
  'fetch',
  'localstorage',
  'subtle-crypto',
  'text-encoder',
] as const;

const DOCS_URL =
  'https://github.com/trustflow-protocol/trustflow-sdk/blob/main/docs/BROWSER_COMPATIBILITY.md';

function globalRef(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}

function has(name: string): boolean {
  return typeof globalRef()[name] !== 'undefined';
}

function cryptoRef(): { subtle?: unknown; getRandomValues?: unknown } | undefined {
  const value = globalRef().crypto;
  return typeof value === 'object' && value !== null
    ? (value as { subtle?: unknown; getRandomValues?: unknown })
    : undefined;
}

/**
 * Detects whether this runtime is a browser, Node, or a worker-like global.
 *
 * Uses the presence of DOM globals rather than `navigator.userAgent`, so it
 * does not misreport Node as a browser because Node defines `navigator`.
 */
export function detectRuntime(): RuntimeKind {
  if (typeof globalRef().window !== 'undefined' && typeof globalRef().document !== 'undefined') {
    return 'browser';
  }
  if (typeof globalRef().WorkerGlobalScope !== 'undefined') return 'worker';
  const proc = globalRef().process as { versions?: { node?: string } } | undefined;
  if (typeof proc?.versions?.node === 'string') return 'node';
  return 'unknown';
}

/**
 * True when the runtime exposes a usable `crypto.subtle` and
 * `crypto.getRandomValues`.
 *
 * `crypto.subtle` is only exposed in a *secure context* — HTTPS, or
 * `http://localhost`. A page served over plain HTTP on a LAN or a non-local
 * host has `crypto.getRandomValues` but no `crypto.subtle`, which is the usual
 * cause of "it works on localhost but not on staging".
 */
export function hasWebCrypto(): boolean {
  const webcrypto = cryptoRef();
  return (
    typeof webcrypto?.getRandomValues === 'function' &&
    typeof webcrypto?.subtle === 'object' &&
    webcrypto.subtle !== null
  );
}

/**
 * Detects every capability the SDK cares about.
 *
 * Pure: safe to call at import time, in SSR, in a worker, or in a test that
 * stubs globals. It never throws and never installs a polyfill.
 *
 * @example
 * ```typescript
 * const report = detectFeatures();
 * if (!report.supported) {
 *   console.error(report.missing.map((f) => `${f.label}: ${f.reason}`).join('\n'));
 * }
 * ```
 */
export function detectFeatures(): EnvironmentReport {
  const runtime = detectRuntime();
  const webcrypto = cryptoRef();
  const hasSubtle = typeof webcrypto?.subtle === 'object' && webcrypto.subtle !== null;
  const hasRandom = typeof webcrypto?.getRandomValues === 'function';

  const features: FeatureSupport[] = [
    {
      name: 'webcrypto',
      label: 'WebCrypto API (crypto.subtle + crypto.getRandomValues)',
      supported: hasWebCrypto(),
      reason: hasWebCrypto()
        ? undefined
        : [
            !hasRandom && 'crypto.getRandomValues is missing',
            !hasSubtle &&
              'crypto.subtle is missing (an insecure context — serve the page over HTTPS, or use http://localhost — hides it)',
          ]
            .filter(Boolean)
            .join('; '),
      docs: DOCS_URL,
    },
    {
      name: 'promise',
      label: 'Promise',
      supported: has('Promise'),
      reason: has('Promise') ? undefined : 'no global Promise; load a Promise polyfill first',
    },
    {
      name: 'bigint',
      label: 'BigInt',
      supported: has('BigInt'),
      reason: has('BigInt')
        ? undefined
        : 'no global BigInt; stroop amounts cannot be represented (ES2020 required)',
    },
    {
      name: 'fetch',
      label: 'fetch',
      supported: typeof globalRef().fetch === 'function',
      reason: typeof globalRef().fetch === 'function' ? undefined : 'no global fetch',
    },
    {
      name: 'localstorage',
      label: 'localStorage',
      supported: typeof globalRef().localStorage !== 'undefined',
      reason:
        typeof globalRef().localStorage === 'undefined'
          ? 'no localStorage; session persistence falls back to process memory'
          : undefined,
    },
    {
      name: 'subtle-crypto',
      label: 'crypto.subtle digest / sign',
      supported: hasSubtle,
      reason: hasSubtle
        ? undefined
        : 'crypto.subtle is missing; SHA-256 hashing and Ed25519 verification are unavailable',
    },
    {
      name: 'text-encoder',
      label: 'TextEncoder / TextDecoder',
      supported: typeof globalRef().TextEncoder === 'function',
      reason: typeof globalRef().TextEncoder === 'function' ? undefined : 'no global TextEncoder',
    },
  ];

  const missing = features.filter(
    (feature) =>
      !feature.supported && (REQUIRED_FEATURES as readonly string[]).includes(feature.name),
  );

  return { runtime, supported: missing.length === 0, features, missing };
}

/**
 * Returns {@link detectFeatures}'s report, throwing when a *required*
 * capability is missing.
 *
 * @param feature - Human-readable name of the operation being attempted, used
 *   in the error message
 * @throws {TrustFlowError} `UNSUPPORTED_ENVIRONMENT` naming every missing capability
 */
export function assertFeatureSupport(feature?: string): EnvironmentReport {
  const report = detectFeatures();
  if (report.supported) return report;

  const reason = report.missing.map((f) => `${f.label} (${f.reason ?? 'unavailable'})`).join('; ');
  const prefix = feature ? `${feature} requires` : 'The TrustFlow SDK requires';
  throw new TrustFlowError(
    `${prefix} browser features that are missing here: ${reason}. See ${DOCS_URL} for supported browsers and polyfill options.`,
    'UNSUPPORTED_ENVIRONMENT',
  );
}

/**
 * Throws unless this runtime can perform WebCrypto operations.
 *
 * Call this at the entry point of anything that hashes, signs or verifies —
 * `auth/challenge` signing, key derivation, signature verification — so the
 * failure names the missing API instead of surfacing as a `TypeError` from
 * deep inside the Stellar SDK.
 *
 * @param feature - Human-readable name of the operation being attempted
 * @throws {TrustFlowError} `UNSUPPORTED_ENVIRONMENT` when WebCrypto is absent
 *
 * @example
 * ```typescript
 * export async function signChallenge(challenge: string) {
 *   assertWebCryptoSupport('signing an auth challenge');
 *   return wallet.sign(challenge);
 * }
 * ```
 */
export function assertWebCryptoSupport(feature?: string): void {
  if (hasWebCrypto()) return;
  const webcrypto = cryptoRef();
  const detail =
    typeof webcrypto === 'undefined'
      ? 'no global crypto object at all'
      : typeof webcrypto.subtle === 'object' && webcrypto.subtle !== null
        ? 'crypto.subtle exists but crypto.getRandomValues is missing'
        : 'crypto.subtle is missing (insecure context — WebCrypto is only exposed over HTTPS or on http://localhost)';
  const prefix = feature ? `${feature} requires` : 'The TrustFlow SDK requires';
  throw new TrustFlowError(
    `${prefix} the WebCrypto API, which is unavailable here: ${detail}. Serve the page over HTTPS, upgrade to a browser with WebCrypto (Chrome 49+, Firefox 52+, Safari 15.4+), or install a WebCrypto polyfill before initialising the SDK. See ${DOCS_URL}.`,
    'UNSUPPORTED_ENVIRONMENT',
  );
}
