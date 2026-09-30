import { rpc, Contract } from '@stellar/stellar-sdk';
import { buildCreateEscrowArgs, buildReleaseArgs, buildDisputeArgs } from '../src/contract/build';
import { invokeContract } from '../src/contract/invoke';
import { readContractState } from '../src/contract/read';
import { simulateContractCall } from '../src/contract/simulate';
import type { TrustFlowClient } from '../src/client';
import { TrustFlowError } from '../src/errors';

jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    rpc: {
      ...original.rpc,
      Server: jest.fn(),
      Api: {
        ...original.rpc.Api,
        isSimulationError: jest.fn(),
      },
      assembleTransaction: jest.fn(),
    },
    Contract: jest.fn(),
    Address: jest.fn().mockImplementation(() => ({
      toScVal: jest.fn().mockReturnValue('mock_scval'),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue('mock_tx'),
    })),
    BASE_FEE: '100',
    scValToNative: jest.fn().mockImplementation((v: unknown) => v),
  };
});

describe('contract module', () => {
  const mockClient = {
    network: 'testnet',
    contractId: 'C...',
    getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
    // Contract calls resolve the account context first so a caller can target a
    // non-active account; `null` means "no account context", the single-account
    // default.
    resolveAccount: jest.fn(() => null),
    // Contract calls now go through the client's shared accessor, so this
    // constructs through the same mocked rpc.Server each test configures.
    getSorobanServer: jest.fn(() => new (rpc.Server as unknown as new () => rpc.Server)()),
  } as unknown as TrustFlowClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('build.ts', () => {
    it('buildCreateEscrowArgs returns valid arguments', () => {
      const args = buildCreateEscrowArgs({
        sender: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        recipient: 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR',
        amountStroops: 1000n,
        durationBlocks: 100,
      });
      expect(args.length).toBe(4);
    });

    it('buildReleaseArgs returns valid arguments', () => {
      const args = buildReleaseArgs(
        'escrow1',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      );
      expect(args.length).toBe(2);
    });

    it('buildDisputeArgs returns valid arguments', () => {
      const args = buildDisputeArgs('escrow1', 'fraud');
      expect(args.length).toBe(2);
    });
  });

  describe('invoke.ts', () => {
    it('returns error if simulation fails', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(true);
      const mockServer = {
        getAccount: jest
          .fn()
          .mockResolvedValue({ accountId: () => 'GBM...', sequenceNumber: () => '1' }),
        simulateTransaction: jest.fn().mockResolvedValue({ error: 'sim error' }),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      const mockContract = {
        call: jest.fn().mockReturnValue({}),
      };
      (Contract as jest.Mock).mockImplementation(() => mockContract);

      const result = await invokeContract(mockClient, 'release', [], 'GBM...');
      expect(result.success).toBe(false);
    });

    it('returns success if simulation succeeds and no signAndSubmit provided', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      const mockServer = {
        getAccount: jest
          .fn()
          .mockResolvedValue({ accountId: () => 'GBM...', sequenceNumber: () => '1' }),
        simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: 'value' } }),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      const mockContract = {
        call: jest.fn().mockReturnValue({}),
      };
      (Contract as jest.Mock).mockImplementation(() => mockContract);

      const result = await invokeContract(mockClient, 'release', [], 'GBM...');
      expect(result.success).toBe(true);
      // @ts-ignore
      expect(result.returnValue).toBe('value');
    });

    it('signs and submits transaction if signAndSubmit is provided', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      const mockServer = {
        getAccount: jest
          .fn()
          .mockResolvedValue({ accountId: () => 'GBM...', sequenceNumber: () => '1' }),
        simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: 'value' } }),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      const mockContract = {
        call: jest.fn().mockReturnValue({}),
      };
      (Contract as jest.Mock).mockImplementation(() => mockContract);

      (rpc.assembleTransaction as jest.Mock).mockReturnValue({
        build: jest.fn().mockReturnValue({ toXDR: () => 'xdr_string' }),
      });

      const signAndSubmit = jest.fn().mockResolvedValue('tx_hash');

      const result = await invokeContract(mockClient, 'release', [], 'GBM...', signAndSubmit);
      expect(result.success).toBe(true);
      // @ts-ignore
      expect(result.txHash).toBe('tx_hash');
      expect(signAndSubmit).toHaveBeenCalledWith('xdr_string');
    });
  });

  describe('read.ts', () => {
    it('readContractState calls simulateTransaction', async () => {
      const mockRetval = { type: 'mock' };
      const mockServer = {
        simulateTransaction: jest.fn().mockResolvedValue({
          result: { retval: mockRetval },
        }),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);

      const mockContract = {
        call: jest.fn().mockReturnValue({}),
      };
      (Contract as jest.Mock).mockImplementation(() => mockContract);

      const result = await readContractState(mockClient, 'get_state');
      expect(mockServer.simulateTransaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('simulate.ts', () => {
    it('returns failure object on simulation error', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(true);
      const mockServer = {
        simulateTransaction: jest.fn().mockResolvedValue({ error: 'failed' }),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      const result = await simulateContractCall(mockClient, 'xdr_string');
      expect(result.success).toBe(false);
      expect(result.error).toBe('failed');
    });

    it('returns success on valid simulation', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      const mockServer = {
        simulateTransaction: jest.fn().mockResolvedValue({}),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      const result = await simulateContractCall(mockClient, 'xdr_string');
      expect(result.success).toBe(true);
    });

    it('throws TrustFlowError on internal exception', async () => {
      const mockServer = {
        simulateTransaction: jest.fn().mockRejectedValue(new Error('Network error')),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      await expect(simulateContractCall(mockClient, 'xdr_string')).rejects.toThrow(TrustFlowError);
    });

    it('populates returnValue from the simulated result', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      const mockServer = {
        simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: 'decoded_value' } }),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      const result = await simulateContractCall(mockClient, 'xdr_string');
      expect(result.success).toBe(true);
      expect(result.returnValue).toBe('decoded_value');
    });

    it('leaves returnValue undefined when the simulation returns no retval', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      const mockServer = {
        simulateTransaction: jest.fn().mockResolvedValue({ result: {} }),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      const result = await simulateContractCall(mockClient, 'xdr_string');
      expect(result.success).toBe(true);
      expect(result.returnValue).toBeUndefined();
    });
  });

  describe('shared Soroban server', () => {
    it('is obtained from the client rather than constructed per call', async () => {
      (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);
      const mockServer = {
        simulateTransaction: jest.fn().mockResolvedValue({ result: {} }),
      };
      (rpc.Server as jest.Mock).mockImplementation(() => mockServer);

      const accessor = mockClient.getSorobanServer as unknown as jest.Mock;
      accessor.mockClear();

      await simulateContractCall(mockClient, 'xdr_string');

      expect(accessor).toHaveBeenCalledTimes(1);
    });
  });
});
