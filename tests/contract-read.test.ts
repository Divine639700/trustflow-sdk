import { readContractState } from '../src/contract/read';
import { rpc, Contract, TransactionBuilder } from '@stellar/stellar-sdk';
import { TrustFlowClient } from '../src/client';
import { TrustFlowError } from '../src/errors';

jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    rpc: {
      ...original.rpc,
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: jest.fn(),
      })),
      Api: {
        ...original.rpc.Api,
        isSimulationError: jest.fn(),
      },
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue('mock_operation'),
    })),
    Account: jest.fn().mockImplementation(() => ({})),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue('mock_tx'),
    })),
    BASE_FEE: '100',
    scValToNative: jest.fn().mockReturnValue('decoded_value'),
  };
});

describe('readContractState', () => {
  let mockClient: TrustFlowClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = new TrustFlowClient({
      network: 'TESTNET',
      contractId: 'C123',
    });
  });

  it('builds a real transaction and simulates it', async () => {
    const mockServer = {
      simulateTransaction: jest.fn().mockResolvedValue({
        result: { retval: 'mock_retval' }
      }),
    };
    (rpc.Server as jest.Mock).mockImplementation(() => mockServer);
    (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(false);

    const result = await readContractState(mockClient, 'get_escrow', ['esc-123']);

    expect(Contract).toHaveBeenCalledWith('C123');
    expect(TransactionBuilder).toHaveBeenCalled();
    expect(mockServer.simulateTransaction).toHaveBeenCalledWith('mock_tx');
    expect(result).toBe('decoded_value');
  });

  it('throws an error if simulation fails', async () => {
    const mockServer = {
      simulateTransaction: jest.fn().mockResolvedValue({}),
    };
    (rpc.Server as jest.Mock).mockImplementation(() => mockServer);
    (rpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(true);

    await expect(readContractState(mockClient, 'get_escrow')).rejects.toThrow(TrustFlowError);
  });
});
