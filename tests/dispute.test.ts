import { DisputeClient } from '../src/escrow/dispute';
import type { ContractConfig } from '../src/types/contract';

const mockHttpPost = jest.fn();
const mockHttpGet = jest.fn();

jest.mock('../src/utils/http', () => ({
  createApiHttpClient: jest.fn(() => ({
    post: mockHttpPost,
    get: mockHttpGet,
  })),
  toApiErrorMessage: (error: unknown) =>
    error instanceof Error ? `Network error: ${error.message}` : `Network error: ${String(error)}`,
}));

describe('DisputeClient', () => {
  beforeEach(() => {
    mockHttpPost.mockReset();
    mockHttpGet.mockReset();
  });

  it('initialises with api url and token', () => {
    const client = new DisputeClient({ apiBaseUrl: 'http://api', apiKey: 'tok' } as any);
    expect(client).toBeDefined();
  });

  it('initialises from ContractConfig with backend credentials', () => {
    const config: ContractConfig = {
      contractId: 'contract-id',
      network: 'TESTNET',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      apiBaseUrl: 'http://api',
      apiKey: 'tok',
    };

    expect(new DisputeClient(config)).toBeDefined();
  });

  it('requires backend URL and API key in ContractConfig', () => {
    const config: ContractConfig = {
      contractId: 'contract-id',
      network: 'TESTNET',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
    };

    expect(() => new DisputeClient(config)).toThrow('apiBaseUrl is required');
    expect(() => new DisputeClient({ ...config, apiBaseUrl: 'http://api' })).toThrow(
      'apiKey is required',
    );
  });

  it('returns success for raiseDispute when API responds with ID', async () => {
    mockHttpPost.mockResolvedValueOnce({ data: { id: 'dsp-1' } });

    const client = new DisputeClient({ apiBaseUrl: 'http://api', apiKey: 'tok' } as any);
    const result = await client.raiseDispute({ escrowId: 'esc-1', reason: 'test' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.disputeId).toBe('dsp-1');
    }
  });

  it('returns error result on network failure', async () => {
    mockHttpPost.mockRejectedValueOnce(new Error('connection reset'));

    const client = new DisputeClient({ apiBaseUrl: 'http://api', apiKey: 'tok' } as any);
    const result = await client.raiseDispute({ escrowId: 'esc-1', reason: 'test' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Network error/);
    }
  });

  it('returns dispute payload for getDispute', async () => {
    mockHttpGet.mockResolvedValueOnce({ data: { id: 'dsp-1', status: 'open' } });

    const client = new DisputeClient({ apiBaseUrl: 'http://api', apiKey: 'tok' } as any);
    const result = await client.getDispute('esc-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ id: 'dsp-1', status: 'open' });
    }
  });
});
