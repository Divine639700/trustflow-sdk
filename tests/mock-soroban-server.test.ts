import {
  createMockSorobanServer,
  createMockHorizonServer,
  buildMockEscrow,
  buildMockEscrowState,
} from '../src/testing/index';
import { TrustFlowClient } from '../src/client';
import { readContractState } from '../src/contract/read';
import { simulateTransaction } from '../src/contract/simulation';
import { Account, TransactionBuilder, BASE_FEE, Contract } from '@stellar/stellar-sdk';
import { TrustFlowError } from '../src/errors';

describe('Offline Mock Soroban RPC Server Provider (Issue #381)', () => {
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
  const dummyAccount = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
  const networkPassphrase = 'Test SDF Future Network ; October 2022';

  function buildTestTx(method: string, ...args: any[]) {
    const contract = new Contract(contractId);
    return new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();
  }

  describe('Pre-canned responses for escrow queries and simulations', () => {
    it('returns pre-canned escrow details on contract read simulation', async () => {
      const mockEscrow = buildMockEscrow({
        id: 'escrow-42',
        amount: 25_000_000n,
        status: 'ACTIVE',
      });

      const mockRpc = createMockSorobanServer({
        escrows: {
          'escrow-42': mockEscrow,
        },
      });

      const client = new TrustFlowClient({
        contractId,
        rpcServer: mockRpc as any,
        horizonServer: createMockHorizonServer() as any,
      });

      const tx = buildTestTx('get_escrow', 'escrow-42');
      const simulation = await simulateTransaction(client.getSorobanServer(), tx);

      expect(simulation.success).toBe(true);
      expect(simulation.returnValue).toBeDefined();
      expect((simulation.returnValue as any).id).toBe('escrow-42');
      expect((simulation.returnValue as any).amount).toBe(25_000_000n);
    });

    it('supports custom method handlers for dynamic responses based on arguments', async () => {
      const mockRpc = createMockSorobanServer({
        methodHandlers: {
          calculate_fee: (args: any[]) => {
            const amount = BigInt(args[0] ?? 0);
            return amount / 100n; // 1% fee
          },
        },
      });

      const client = new TrustFlowClient({
        contractId,
        rpcServer: mockRpc as any,
      });

      const tx = buildTestTx('calculate_fee', 50_000n);
      const outcome = await simulateTransaction(client.getSorobanServer(), tx);

      expect(outcome.success).toBe(true);
      expect(outcome.returnValue).toBe(500n);
    });

    it('allows mutating pre-canned escrows dynamically during tests', async () => {
      const mockRpc = createMockSorobanServer();
      expect(mockRpc.getEscrow('100')).toBeUndefined();

      const newEscrow = buildMockEscrowState({ id: '100', status: 'completed' });
      mockRpc.setEscrow('100', newEscrow);
      expect(mockRpc.getEscrow('100')).toEqual(newEscrow);

      mockRpc.deleteEscrow('100');
      expect(mockRpc.getEscrow('100')).toBeUndefined();
    });
  });

  describe('Simulating network latency', () => {
    it('delays response when latencyMs is specified', async () => {
      const latencyMs = 60;
      const mockRpc = createMockSorobanServer({ latencyMs });

      const start = Date.now();
      await mockRpc.getLatestLedger();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(latencyMs - 10);
    });

    it('allows dynamically changing latency', async () => {
      const mockRpc = createMockSorobanServer({ latencyMs: 0 });

      const start1 = Date.now();
      await mockRpc.getLatestLedger();
      const elapsed1 = Date.now() - start1;
      expect(elapsed1).toBeLessThan(50);

      mockRpc.setLatency(70);
      const start2 = Date.now();
      await mockRpc.getLatestLedger();
      const elapsed2 = Date.now() - start2;
      expect(elapsed2).toBeGreaterThanOrEqual(60);
    });
  });

  describe('Simulating error conditions', () => {
    it('simulates RPC transport network errors', async () => {
      const mockRpc = createMockSorobanServer({
        error: new Error('Network error: ECONNREFUSED'),
      });

      await expect(mockRpc.simulateTransaction({} as any)).rejects.toThrow(
        'Network error: ECONNREFUSED',
      );
      await expect(mockRpc.sendTransaction({} as any)).rejects.toThrow(
        'Network error: ECONNREFUSED',
      );
      await expect(mockRpc.getTransaction('hash')).rejects.toThrow('Network error: ECONNREFUSED');

      // Clear error and verify recovery
      mockRpc.clearError();
      const res = await mockRpc.getLatestLedger();
      expect(res.sequence).toBe(1000);
    });

    it('simulates contract simulation errors (host contract trap)', async () => {
      const mockRpc = createMockSorobanServer({
        simulationError: 'Host error: contract trap: EscrowAlreadyReleased',
      });

      const client = new TrustFlowClient({
        contractId,
        rpcServer: mockRpc as any,
      });

      const tx = buildTestTx('release_escrow', 'esc-1');
      const outcome = await simulateTransaction(client.getSorobanServer(), tx);

      expect(outcome.success).toBe(false);
      expect(outcome.error).toBe('Host error: contract trap: EscrowAlreadyReleased');
    });

    it('simulates simulation restore preamble requirement', async () => {
      const mockRpc = createMockSorobanServer({
        simulationRestore: true,
      });

      const client = new TrustFlowClient({
        contractId,
        rpcServer: mockRpc as any,
      });

      const tx = buildTestTx('get_escrow', 'esc-1');
      const outcome = await simulateTransaction(client.getSorobanServer(), tx);

      expect(outcome.success).toBe(false);
      expect(outcome.needsRestore).toBe(true);
      expect(outcome.restorePreamble).toBeDefined();
    });

    it('simulates transaction submission and failed status', async () => {
      const mockRpc = createMockSorobanServer({
        txStatus: 'FAILED',
      });

      const sendRes = await mockRpc.sendTransaction({} as any);
      expect(sendRes.status).toBe('PENDING');

      const txRes = await mockRpc.getTransaction(sendRes.hash);
      expect(txRes.status).toBe('FAILED');
    });
  });

  describe('Offline end-to-end simulation flow', () => {
    it('runs contract read without local Stellar quickstart node', async () => {
      const escrow = buildMockEscrow({
        id: 'offline-escrow-1',
        amount: 100_000_000n,
      });

      const mockRpc = createMockSorobanServer({
        escrows: {
          'offline-escrow-1': escrow,
        },
      });

      const client = new TrustFlowClient({
        contractId,
        rpcServer: mockRpc as any,
      });

      const result = await readContractState(client, 'get_escrow', ['offline-escrow-1']);
      expect(result).toBeDefined();
      expect((result as any).id).toBe('offline-escrow-1');
      expect((result as any).amount).toBe(100_000_000n);
    });
  });
});
