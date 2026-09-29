/**
 * Minimal CID (content identifier) validation, covering the two shapes IPFS
 * gateways and upload APIs return:
 *
 * - **CIDv0** — base58btc, always `Qm` followed by 44 base58 characters
 *   (46 chars total).
 * - **CIDv1** — multibase-prefixed; the common base32 encoding starts with
 *   `b` followed by lowercase base32 characters (`a-z`, `2-7`).
 *
 * This is a syntactic check only — it does not decode the multihash or
 * verify the content exists.
 */
export function isValidCid(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;

  // CIDv0: "Qm" + 44 base58 chars.
  if (value.startsWith('Qm')) {
    return /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{46}$/.test(value);
  }

  // CIDv1: a single multibase prefix character followed by the encoded
  // multicodec + multihash payload. Base32 ("b") is what `ipfs://` URLs and
  // web3.storage-style APIs produce; accept any single-letter prefix with a
  // non-empty lowercase payload rather than enumerating every multibase.
  if (value.length < 2) return false;
  const [prefix, ...payload] = value;
  if (!/^[a-zA-Z]$/.test(prefix)) return false;
  return payload.length > 0 && /^[a-z2-7]+$/.test(payload.join(''));
}
