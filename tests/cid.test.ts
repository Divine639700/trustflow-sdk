import {
  isValidCid,
  getCidVersion,
  assertValidCid,
  CID_V0_REGEX,
  CID_V1_REGEX,
} from '../src/storage/cid';
import { CidSchema } from '../src/schemas';
import { TrustFlowError } from '../src/errors';

describe('CID validation utilities (#233)', () => {
  const validV0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
  const validV0Another = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
  const validV1Base32 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
  const validV1Base58 = 'zdj7Wn9FqaYvNfm9Zkp4eH84V33b2tNn918k6Qd2d2Ld2F1bA';

  describe('isValidCid', () => {
    it('accepts valid CIDv0 strings', () => {
      expect(isValidCid(validV0)).toBe(true);
      expect(isValidCid(validV0Another)).toBe(true);
    });

    it('accepts valid CIDv1 strings', () => {
      expect(isValidCid(validV1Base32)).toBe(true);
      expect(isValidCid(validV1Base58)).toBe(true);
    });

    it('rejects path traversal and slashes', () => {
      expect(isValidCid(`../${validV0}`)).toBe(false);
      expect(isValidCid(`ipfs/${validV0}`)).toBe(false);
      expect(isValidCid(`${validV1Base32}/sub/path`)).toBe(false);
      expect(isValidCid(`..\\${validV1Base32}`)).toBe(false);
    });

    it('rejects whitespace and invalid characters', () => {
      expect(isValidCid(` ${validV0} `)).toBe(false);
      expect(isValidCid('')).toBe(false);
      expect(isValidCid('not-a-cid')).toBe(false);
      expect(isValidCid(123 as any)).toBe(false);
    });
  });

  describe('getCidVersion', () => {
    it('returns 0 for CIDv0', () => {
      expect(getCidVersion(validV0)).toBe(0);
      expect(getCidVersion(validV0Another)).toBe(0);
    });

    it('returns 1 for CIDv1', () => {
      expect(getCidVersion(validV1Base32)).toBe(1);
      expect(getCidVersion(validV1Base58)).toBe(1);
    });

    it('returns null for invalid CIDs', () => {
      expect(getCidVersion('invalid')).toBe(null);
      expect(getCidVersion('')).toBe(null);
      expect(getCidVersion(`../${validV0}`)).toBe(null);
    });
  });

  describe('assertValidCid', () => {
    it('does not throw for valid CID', () => {
      expect(() => assertValidCid(validV0)).not.toThrow();
      expect(() => assertValidCid(validV1Base32, 'evidenceCid')).not.toThrow();
    });

    it('throws TrustFlowError with VALIDATION_ERROR and field name', () => {
      try {
        assertValidCid('invalid', 'myField');
        throw new Error('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrustFlowError);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.field).toBe('myField');
      }
    });
  });

  describe('CidSchema (Zod)', () => {
    it('parses valid CIDs', () => {
      expect(CidSchema.safeParse(validV0).success).toBe(true);
      expect(CidSchema.safeParse(validV1Base32).success).toBe(true);
    });

    it('rejects invalid CIDs with a helpful error message', () => {
      const result = CidSchema.safeParse('not-valid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('CID');
      }
    });
  });
});
