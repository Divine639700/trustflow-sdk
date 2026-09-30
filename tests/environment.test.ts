import {
  REQUIRED_FEATURES,
  assertFeatureSupport,
  assertWebCryptoSupport,
  detectFeatures,
  detectRuntime,
  hasWebCrypto,
} from '../src/utils/environment';
import { TrustFlowError } from '../src/errors';

const globals = globalThis as unknown as Record<string, unknown>;

/** A minimal stand-in for `crypto` with only the pieces detection inspects. */
function fakeCrypto(options: { subtle?: boolean; random?: boolean }): unknown {
  return {
    getRandomValues: options.random === false ? undefined : () => new Uint8Array(1),
    subtle: options.subtle === false ? undefined : { digest: () => new ArrayBuffer(0) },
  };
}

describe('detectRuntime', () => {
  const saved = { ...globals };

  afterEach(() => {
    for (const key of ['window', 'document', 'WorkerGlobalScope', 'process']) {
      if (saved[key] === undefined) delete globals[key];
      else globals[key] = saved[key];
    }
  });

  it('detects a browser from DOM globals, not from navigator', () => {
    globals.window = {};
    globals.document = {};
    globals.process = { versions: { node: '20.0.0' } };
    expect(detectRuntime()).toBe('browser');
  });

  it('detects node from process.versions.node', () => {
    delete globals.window;
    delete globals.document;
    globals.process = { versions: { node: '20.0.0' } };
    expect(detectRuntime()).toBe('node');
  });

  it('detects a worker-like global', () => {
    delete globals.window;
    delete globals.document;
    delete globals.process;
    globals.WorkerGlobalScope = class {};
    expect(detectRuntime()).toBe('worker');
    delete globals.WorkerGlobalScope;
  });

  it('falls back to unknown', () => {
    delete globals.window;
    delete globals.document;
    delete globals.process;
    delete globals.WorkerGlobalScope;
    expect(detectRuntime()).toBe('unknown');
  });
});

describe('hasWebCrypto', () => {
  const original = globals.crypto;

  afterEach(() => {
    if (original === undefined) delete globals.crypto;
    else globals.crypto = original;
  });

  it('is true when both crypto.subtle and crypto.getRandomValues exist', () => {
    globals.crypto = fakeCrypto({});
    expect(hasWebCrypto()).toBe(true);
  });

  it('is false in an insecure context where crypto.subtle is hidden', () => {
    // Safari < 15.4, and any page served over plain http:// on a non-local host.
    globals.crypto = fakeCrypto({ subtle: false });
    expect(hasWebCrypto()).toBe(false);
  });

  it('is false when getRandomValues is missing', () => {
    globals.crypto = fakeCrypto({ random: false });
    expect(hasWebCrypto()).toBe(false);
  });

  it('is false when there is no crypto at all', () => {
    delete globals.crypto;
    expect(hasWebCrypto()).toBe(false);
  });
});

describe('detectFeatures', () => {
  const original = globals.crypto;

  afterEach(() => {
    if (original === undefined) delete globals.crypto;
    else globals.crypto = original;
  });

  it('reports a supported environment without throwing', () => {
    globals.crypto = fakeCrypto({});
    const report = detectFeatures();
    expect(report.supported).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.features.map((f) => f.name)).toEqual(
      expect.arrayContaining([...REQUIRED_FEATURES, 'fetch', 'subtle-crypto']),
    );
  });

  it('is marked unsupported and names the reason when WebCrypto is absent', () => {
    delete globals.crypto;
    const report = detectFeatures();
    expect(report.supported).toBe(false);
    expect(report.missing.map((f) => f.name)).toContain('webcrypto');

    const webcrypto = report.features.find((f) => f.name === 'webcrypto')!;
    expect(webcrypto.supported).toBe(false);
    expect(webcrypto.label).toMatch(/WebCrypto/);
    // The message must explain the *insecure context* cause, which is the usual
    // reason a page works on localhost and fails in production.
    expect(webcrypto.reason).toMatch(/insecure context/);
    expect(webcrypto.docs).toMatch(/BROWSER_COMPATIBILITY/);
  });

  it('explains a missing getRandomValues distinctly', () => {
    globals.crypto = { subtle: {} };
    const report = detectFeatures();
    const webcrypto = report.features.find((f) => f.name === 'webcrypto')!;
    expect(webcrypto.reason).toMatch(/getRandomValues is missing/);
  });

  it('reports optional gaps without marking the environment unsupported', () => {
    const originalFetch = globals.fetch;
    const originalStorage = globals.localStorage;
    delete globals.fetch;
    delete globals.localStorage;
    try {
      const report = detectFeatures();
      expect(report.supported).toBe(true);
      const fetch = report.features.find((f) => f.name === 'fetch')!;
      expect(fetch.supported).toBe(false);
      expect(fetch.reason).toMatch(/no global fetch/);
      const storage = report.features.find((f) => f.name === 'localstorage')!;
      expect(storage.reason).toMatch(/process memory/);
    } finally {
      globals.fetch = originalFetch;
      if (originalStorage === undefined) delete globals.localStorage;
      else globals.localStorage = originalStorage;
    }
  });
});

describe('assertFeatureSupport / assertWebCryptoSupport', () => {
  const original = globals.crypto;

  afterEach(() => {
    if (original === undefined) delete globals.crypto;
    else globals.crypto = original;
  });

  it('passes silently in a capable environment', () => {
    globals.crypto = fakeCrypto({});
    expect(() => assertWebCryptoSupport('signing')).not.toThrow();
    expect(() => assertFeatureSupport('reading state')).not.toThrow();
  });

  it('throws UNSUPPORTED_ENVIRONMENT naming the feature and the requirement', () => {
    globals.crypto = fakeCrypto({ subtle: false });
    expect(() => assertWebCryptoSupport('signing an auth challenge')).toThrow(TrustFlowError);

    try {
      assertWebCryptoSupport('signing an auth challenge');
      throw new Error('expected a throw');
    } catch (e) {
      const err = e as TrustFlowError;
      expect(err.code).toBe('UNSUPPORTED_ENVIRONMENT');
      expect(err.message).toMatch(/signing an auth challenge requires the WebCrypto API/);
      expect(err.message).toMatch(/insecure context/);
      // Actionable: names the browsers and the fix.
      expect(err.message).toMatch(/HTTPS/);
      expect(err.message).toMatch(/Chrome 49\+, Firefox 52\+, Safari 15\.4\+/);
      expect(err.message).toMatch(/polyfill/);
      expect(err.message).toMatch(/BROWSER_COMPATIBILITY/);
    }
  });

  it('explains a completely missing crypto object', () => {
    delete globals.crypto;
    try {
      assertWebCryptoSupport();
      throw new Error('expected a throw');
    } catch (e) {
      const err = e as TrustFlowError;
      expect(err.code).toBe('UNSUPPORTED_ENVIRONMENT');
      expect(err.message).toMatch(/no global crypto object at all/);
    }
  });

  it('throws an UNSUPPORTED_ENVIRONMENT error for a missing required feature', () => {
    const originalBigInt = globals.BigInt;
    delete globals.BigInt;
    try {
      assertFeatureSupport('reading stroop amounts');
      throw new Error('expected a throw');
    } catch (e) {
      const err = e as TrustFlowError;
      expect(err.code).toBe('UNSUPPORTED_ENVIRONMENT');
      expect(err.message).toMatch(/BigInt/);
    } finally {
      globals.BigInt = originalBigInt;
    }
  });
});
