import {
  formatAmount,
  parseAmount,
  stroopsToXLM,
  formatDateTime,
  formatRelativeTime,
  formatDuration,
  truncateAddress,
} from '../src/utils/format';
import {
  isValidAddress,
  isValidStellarAddress,
  isValidContractId,
  isValidCID,
  isValidCIDv0,
  isValidCIDv1,
  getCIDVersion,
  assertValidCID,
} from '../src/utils/validation';

const VALID_G = 'G' + 'A'.repeat(55);
const VALID_C = 'C' + 'A'.repeat(55);
const CID_V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const CID_V1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

describe('amount utilities', () => {
  it('formatAmount aliases stroopsToXLM', () => {
    expect(formatAmount(10_000_000n)).toBe('1');
    expect(formatAmount(1_500_000n)).toBe(stroopsToXLM(1_500_000n));
  });

  it('parseAmount round-trips with formatAmount', () => {
    expect(parseAmount('1')).toBe(10_000_000n);
    expect(parseAmount('1.5')).toBe(15_000_000n);
    expect(parseAmount('0.0000001')).toBe(1n);
    expect(formatAmount(parseAmount('12.3456789'))).toBe('12.3456789');
  });

  it('parseAmount rejects malformed input', () => {
    expect(() => parseAmount('1.2.3')).toThrow();
  });
});

describe('isValidAddress', () => {
  it('accepts valid G and C addresses', () => {
    expect(isValidAddress(VALID_G)).toBe(true);
    expect(isValidAddress(VALID_C)).toBe(true);
  });

  it('rejects invalid addresses', () => {
    expect(isValidAddress('invalid')).toBe(false);
    expect(isValidAddress('')).toBe(false);
    expect(isValidStellarAddress(VALID_C)).toBe(false);
    expect(isValidContractId(VALID_G)).toBe(false);
  });

  it('truncateAddress short-circuits short input', () => {
    expect(truncateAddress('short')).toBe('short');
  });
});

describe('CID validation', () => {
  it('accepts CIDv0 and CIDv1', () => {
    expect(isValidCID(CID_V0)).toBe(true);
    expect(isValidCID(CID_V1)).toBe(true);
    expect(isValidCIDv0(CID_V0)).toBe(true);
    expect(isValidCIDv1(CID_V1)).toBe(true);
    expect(isValidCIDv0(CID_V1)).toBe(false);
    expect(isValidCIDv1(CID_V0)).toBe(false);
  });

  it('rejects invalid CIDs', () => {
    expect(isValidCID('invalid')).toBe(false);
    expect(isValidCID('')).toBe(false);
  });

  it('getCIDVersion distinguishes versions', () => {
    expect(getCIDVersion(CID_V0)).toBe(0);
    expect(getCIDVersion(CID_V1)).toBe(1);
    expect(getCIDVersion('nope')).toBeNull();
  });

  it('assertValidCID throws on invalid input', () => {
    expect(() => assertValidCID(CID_V0)).not.toThrow();
    expect(() => assertValidCID('bad')).toThrow();
  });
});

describe('date formatting helpers', () => {
  it('formatDateTime returns a localized string', () => {
    const out = formatDateTime(1705330245000, 'en-US');
    expect(typeof out).toBe('string');
    expect(out).toContain('2024');
  });

  it('formatRelativeTime returns a relative string', () => {
    const out = formatRelativeTime(Date.now() - 3600_000);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('formatDuration formats durations', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(3661000)).toContain('1h');
    expect(formatDuration(3661000, true)).not.toContain('1s');
  });
});
