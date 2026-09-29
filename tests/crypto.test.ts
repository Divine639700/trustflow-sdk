import { randomBytes, randomHex, randomNonce, randomUUID } from '../src/utils/crypto';

describe('Secure Random Generation (#298)', () => {
  it('generates random bytes of requested length', () => {
    const bytes16 = randomBytes(16);
    const bytes32 = randomBytes(32);

    expect(bytes16.length).toBe(16);
    expect(bytes32.length).toBe(32);
    expect(bytes16).toBeInstanceOf(Uint8Array);

    // Verify non-zero randomness
    const sum = bytes16.reduce((acc, val) => acc + val, 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('generates random hex strings', () => {
    const hex = randomHex(16);
    expect(hex.length).toBe(32);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates random nonce strings of specified length', () => {
    const nonce = randomNonce(24);
    expect(nonce.length).toBe(24);
    expect(nonce).toMatch(/^[A-Za-z0-9]{24}$/);
  });

  it('generates valid RFC 4122 v4 UUIDs', () => {
    const uuid = randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const uuid2 = randomUUID();
    expect(uuid).not.toBe(uuid2);
  });
});
