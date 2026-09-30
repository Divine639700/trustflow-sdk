import { Account, Networks, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { TrustFlowError } from '../src/errors';
import { generateSep7Uri, SEP7_MAX_URI_LENGTH } from '../src/wallet';

const source = 'GAU2ZSYYEYO5S5ZQSMMUENJ2TANY4FPXYGGIMU6GMGKTNVDG5QYFW6JS';
const envelope = new TransactionBuilder(new Account(source, '1'), {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.manageData({ name: 'sep7', value: 'test' }))
  .setTimeout(30)
  .build()
  .toEnvelope()
  .toXDR('base64');

describe('generateSep7Uri', () => {
  it('encodes the complete transaction envelope in a SEP-0007 tx URI for a QR payload', () => {
    const uri = generateSep7Uri(envelope);
    expect(uri).toBe(`web+stellar:tx?xdr=${encodeURIComponent(envelope)}`);
    const encoded = uri.slice('web+stellar:tx?xdr='.length);
    expect(
      xdr.TransactionEnvelope.fromXDR(decodeURIComponent(encoded), 'base64').toXDR('base64'),
    ).toBe(envelope);
  });

  it('encodes callback type, message, testnet passphrase and origin domain by their SEP-0007 names', () => {
    const uri = generateSep7Uri(envelope, {
      callbackUrl: 'https://example.org/signed?order=1&state=a+b',
      message: 'Release escrow #1 ✓',
      networkPassphrase: Networks.TESTNET,
      originDomain: 'wallet.example.org',
    });
    expect(uri).toBe(
      `web+stellar:tx?xdr=${encodeURIComponent(envelope)}` +
        `&callback=${encodeURIComponent('url:https://example.org/signed?order=1&state=a+b')}` +
        `&msg=${encodeURIComponent('Release escrow #1 ✓')}` +
        `&network_passphrase=${encodeURIComponent(Networks.TESTNET)}` +
        '&origin_domain=wallet.example.org',
    );
  });

  it.each(['', 'not base64', 'AAAA', 'AA==', 'AAAA\n'])(
    'rejects invalid transaction XDR: %j',
    (invalid) => {
      expect(() => generateSep7Uri(invalid)).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'xdr' }),
      );
    },
  );

  it.each([
    'relative/path',
    'javascript:alert(1)',
    'https://user:pass@example.org/',
    'https://example.org/a b',
  ])('rejects an invalid callback URL: %s', (callbackUrl) => {
    expect(() => generateSep7Uri(envelope, { callbackUrl })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'callbackUrl' }),
    );
  });

  it('enforces the SEP-0007 300-character message limit before URL encoding', () => {
    expect(generateSep7Uri(envelope, { message: '✓'.repeat(300) })).toContain('&msg=');
    expect(() => generateSep7Uri(envelope, { message: '✓'.repeat(301) })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'message' }),
    );
    expect(() => generateSep7Uri(envelope, { message: '😀'.repeat(300) })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'uri' }),
    );
  });

  it.each(['https://example.org', 'localhost', 'bad..example.org', '-bad.example.org'])(
    'rejects a non-domain origin: %s',
    (originDomain) => {
      expect(() => generateSep7Uri(envelope, { originDomain })).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'originDomain' }),
      );
    },
  );

  it('accepts an exact custom limit and rejects a shorter one', () => {
    const uri = generateSep7Uri(envelope);
    expect(generateSep7Uri(envelope, { maxUriLength: uri.length })).toBe(uri);
    expect(() => generateSep7Uri(envelope, { maxUriLength: uri.length - 1 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'uri' }),
    );
    expect(() => generateSep7Uri(envelope, { maxUriLength: 0 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'maxUriLength' }),
    );
    expect(() => generateSep7Uri(envelope, { maxUriLength: SEP7_MAX_URI_LENGTH + 1 })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'maxUriLength' }),
    );
  });

  it('rejects a payload beyond the default QR byte-mode limit', () => {
    expect(() =>
      generateSep7Uri(envelope, {
        callbackUrl: `https://example.org/${'a'.repeat(SEP7_MAX_URI_LENGTH)}`,
      }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR', field: 'uri' }));
  });

  it('uses the shared SDK validation error class', () => {
    expect(() => generateSep7Uri('')).toThrow(TrustFlowError);
  });
});
