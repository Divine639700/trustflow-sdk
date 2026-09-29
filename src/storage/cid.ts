import { TrustFlowError } from '../errors';

/** CIDv0 regex: base58btc encoded multihash, starts with Qm, 46 characters long. */
export const CID_V0_REGEX = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

/**
 * CIDv1 regex: multibase encoded CID.
 * Handles base32 (starts with b, base32 lowercase alphabet [a-z2-7])
 * and base58btc (starts with z, base58 alphabet [1-9A-HJ-NP-Za-km-z]).
 */
export const CID_V1_REGEX = /^(?:b[a-z2-7]{50,100}|z[1-9A-HJ-NP-Za-km-z]{45,100})$/;

/**
 * Validates whether a string is a valid CID (CIDv0 or CIDv1).
 * Rejects path traversal (`..`), slashes, whitespace, and invalid characters.
 */
export function isValidCid(cid: string): boolean {
  if (typeof cid !== 'string') return false;
  const trimmed = cid.trim();
  if (trimmed !== cid || trimmed.length === 0) return false;
  if (cid.includes('/') || cid.includes('\\') || cid.includes('..')) return false;

  return CID_V0_REGEX.test(cid) || CID_V1_REGEX.test(cid);
}

/**
 * Returns the CID version (0 or 1) for a given string, or null if invalid.
 */
export function getCidVersion(cid: string): 0 | 1 | null {
  if (typeof cid !== 'string') return null;
  const trimmed = cid.trim();
  if (trimmed !== cid || trimmed.length === 0) return null;
  if (cid.includes('/') || cid.includes('\\') || cid.includes('..')) return null;

  if (CID_V0_REGEX.test(cid)) return 0;
  if (CID_V1_REGEX.test(cid)) return 1;
  return null;
}

/**
 * Asserts that a CID string is valid, throwing a `TrustFlowError` with code `VALIDATION_ERROR` if not.
 */
export function assertValidCid(cid: string, field = 'cid'): void {
  if (!isValidCid(cid)) {
    throw TrustFlowError.validation(field, `Invalid CID for "${field}": ${cid}`);
  }
}
