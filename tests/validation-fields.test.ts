import { TrustFlowError } from '../src/errors';
import { parseRpcResponse, DisputeEscrowSchema, CreateEscrowSchema, ClientConfigSchema } from '../src/schemas';
import { createEscrow } from '../src/escrow/create';
import { releaseEscrow } from '../src/escrow/release';
import { cancelEscrow, getEscrow } from '../src/escrow/cancel';
import { disputeEscrow, DisputeClient } from '../src/escrow/dispute';
import { TrustFlowEscrowClient } from '../src/escrow/client';
import { TrustFlowClient } from '../src/client';
import { z } from 'zod';

describe('Field-addressable validation and public method validation (#214)', () => {
  const validAddr = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const otherAddr = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR';
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

  describe('TrustFlowError.validation', () => {
    it('sets field and issues on error instance', () => {
      const issues = [{ path: ['amount'], message: 'Too small' }];
      const err = TrustFlowError.validation('amount', 'must be positive', issues);
      expect(err.field).toBe('amount');
      expect(err.issues).toEqual(issues);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toContain('Validation failed for amount: must be positive');
    });
  });

  describe('parseRpcResponse', () => {
    it('attaches issues to TrustFlowError on schema failure', () => {
      const TestSchema = z.object({ id: z.string(), count: z.number() });
      try {
        parseRpcResponse(TestSchema, { id: 123 }, 'getRecord');
        throw new Error('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrustFlowError);
        expect(err.field).toBe('getRecord');
        expect(err.issues).toBeDefined();
        expect(Array.isArray(err.issues)).toBe(true);
      }
    });
  });

  describe('DisputeEscrowSchema evidence validation', () => {
    it('accepts valid IPFS URIs and CIDs as evidence', () => {
      const validCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      expect(
        DisputeEscrowSchema.safeParse({
          escrowId: 'esc-1',
          reason: 'dispute reason is long enough',
          evidence: `ipfs://${validCid}`,
        }).success,
      ).toBe(true);

      expect(
        DisputeEscrowSchema.safeParse({
          escrowId: 'esc-1',
          reason: 'dispute reason is long enough',
          evidence: validCid,
        }).success,
      ).toBe(true);

      expect(
        DisputeEscrowSchema.safeParse({
          escrowId: 'esc-1',
          reason: 'dispute reason is long enough',
          evidence: 'https://example.com/evidence.pdf',
        }).success,
      ).toBe(true);
    });

    it('rejects invalid evidence formats', () => {
      expect(
        DisputeEscrowSchema.safeParse({
          escrowId: 'esc-1',
          reason: 'dispute reason is long enough',
          evidence: 'not a valid url or cid',
        }).success,
      ).toBe(false);
    });
  });

  describe('ClientConfigSchema', () => {
    it('validates extended config with balanceCache and ipfs', () => {
      const result = ClientConfigSchema.safeParse({
        contractId,
        network: 'TESTNET',
        balanceCache: { ttlMs: 10000 },
        ipfs: { apiUrl: 'https://ipfs.example.com/upload' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Client getBalance validation', () => {
    it('rejects invalid Stellar addresses', async () => {
      const client = new TrustFlowClient({ contractId });
      await expect(client.getBalance('not-an-address')).rejects.toThrow(TrustFlowError);
    });
  });

  describe('TrustFlowEscrowClient validation', () => {
    let client: TrustFlowEscrowClient;

    beforeEach(() => {
      client = new TrustFlowEscrowClient({
        contractId,
        network: 'TESTNET',
        rpcUrl: 'https://rpc.example.com',
        networkPassphrase: 'pass',
        apiBaseUrl: 'https://api.example.com',
      });
    });

    it('validates inputs in releaseEscrow', async () => {
      const res = await client.releaseEscrow('', validAddr);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('escrowId');
    });

    it('validates inputs in getEscrow', async () => {
      const res = await client.getEscrow('');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('escrowId');
    });

    it('validates inputs in claim', async () => {
      const res = await client.claim('', validAddr);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('escrowId');
    });

    it('validates inputs in fund', async () => {
      const res = await client.fund('', validAddr, 100n);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('escrowId');

      const resZero = await client.fund('esc-1', validAddr, 0n);
      expect(resZero.ok).toBe(false);
      expect(resZero.error).toContain('positive');
    });
  });
});
