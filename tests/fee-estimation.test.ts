import { TransactionPipeline } from '../src/tx-pipeline/pipeline';
import { TrustFlowClient } from '../src/client';
import { BASE_FEE, Operation, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { simulateContractCall } from '../src/contract/simulate';
import { invokeContract } from '../src/contract/invoke';

describe('Fee Estimation & Cost Propagation (#231)', () => {
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
  const sourceAccount = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  let client: TrustFlowClient;
  let pipeline: TransactionPipeline;

  beforeEach(() => {
    client = new TrustFlowClient({ contractId, network: 'TESTNET' });
    pipeline = new TransactionPipeline(client);
  });

  describe('TransactionPipeline.estimateFee', () => {
    it('estimates resource and inclusion fee ranges from simulation', async () => {
      const mockSimResponse = {
        minResourceFee: '15000',
        cost: {
          cpuInsns: '120000',
          memBytes: '45000',
        },
        result: {
          retval: null,
        },
      };

      jest.spyOn((pipeline as any).server, 'simulateTransaction').mockResolvedValueOnce(mockSimResponse as any);

      const fakeTx = {
        fee: '100',
      } as any;

      const result = await pipeline.estimateFee(fakeTx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.resourceFee).toBe('16500'); // 15000 * 1.1
        expect(result.data.inclusionFee.min).toBe('100');
        expect(result.data.inclusionFee.recommended).toBe('200');
        expect(result.data.inclusionFee.max).toBe('1000');
        expect(result.data.total.min).toBe('16600');
        expect(result.data.total.recommended).toBe('16700');
        expect(result.data.total.max).toBe('17500');
        expect(result.data.cost.cpuInsns).toBe('120000');
        expect(result.data.cost.memBytes).toBe('45000');
      }
    });

    it('applies toleranceMultiplier and custom resourceFeeMultiplier', async () => {
      const mockSimResponse = {
        minResourceFee: '10000',
        cost: { cpuInsns: '50000', memBytes: '10000' },
      };

      jest.spyOn((pipeline as any).server, 'simulateTransaction').mockResolvedValueOnce(mockSimResponse as any);

      const fakeTx = { fee: '100' } as any;
      const result = await pipeline.estimateFee(fakeTx, {
        resourceFeeMultiplier: 1.2,
        toleranceMultiplier: 1.5,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.resourceFee).toBe('12000');
        expect(result.data.inclusionFee.min).toBe('150');
      }
    });
  });

  describe('simulateContractCall cost propagation', () => {
    it('populates cost.cpuInsns and cost.memBytes from RPC response', async () => {
      const mockSorobanServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          cost: {
            cpuInsns: '999999',
            memBytes: '88888',
          },
          result: { retval: null },
        }),
      };
      jest.spyOn(client, 'getSorobanServer').mockReturnValue(mockSorobanServer as any);

      const sim = await simulateContractCall(client, 'AAAA...');
      expect(sim.success).toBe(true);
      expect(sim.cost.cpuInsns).toBe('999999');
      expect(sim.cost.memBytes).toBe('88888');
    });
  });

  describe('invokeContract gasUsed propagation', () => {
    it('populates gasUsed from simulation cost.cpuInsns or minResourceFee', async () => {
      const mockSorobanServer = {
        getAccount: jest.fn().mockResolvedValue({
          accountId: () => sourceAccount,
          sequenceNumber: () => '1',
          incrementSequenceNumber: () => {},
        }),
        simulateTransaction: jest.fn().mockResolvedValue({
          minResourceFee: '25000',
          cost: {
            cpuInsns: '75000',
          },
          result: { retval: null },
        }),
      };
      jest.spyOn(client, 'getSorobanServer').mockReturnValue(mockSorobanServer as any);

      const result = await invokeContract(client, 'testMethod', [], sourceAccount);
      expect(result.success).toBe(true);
      expect(result.gasUsed).toBe(75000);
    });
  });
});
