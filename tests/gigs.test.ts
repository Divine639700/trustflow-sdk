import { TrustFlowEscrowClient } from '../src/escrow/client';
import type { GigsPage } from '../src/types/index';
import { createApiHttpClient } from '../src/utils/http';

const mockHttpGet = jest.fn();
const mockToApiErrorMessage = jest.fn((error: unknown) => {
  if (error instanceof Error) {
    return `Network error: ${error.message}`;
  }
  return `Network error: ${String(error)}`;
});

jest.mock('../src/utils/http', () => ({
  createApiHttpClient: jest.fn(() => ({ get: mockHttpGet })),
  toApiErrorMessage: (error: unknown) => mockToApiErrorMessage(error),
}));

const BASE_CONTRACT_CONFIG = {
  contractId: 'C' + 'A'.repeat(55),
  network: 'TESTNET' as const,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

const API_BASE = 'https://api.trustflow.xyz';
const API_KEY = 'test-api-key';

const makePage = (overrides: Partial<GigsPage> = {}): GigsPage => ({
  data: [],
  nextCursor: null,
  hasMore: false,
  ...overrides,
});

describe('TrustFlowEscrowClient.getGigs', () => {
  beforeEach(() => {
    mockHttpGet.mockReset();
    mockToApiErrorMessage.mockClear();
    jest.mocked(createApiHttpClient).mockClear();
  });

  it('returns an error when apiBaseUrl is not configured', async () => {
    const client = new TrustFlowEscrowClient(BASE_CONTRACT_CONFIG);
    const result = await client.getGigs();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/apiBaseUrl/);
    }
  });

  it('returns an empty first page when no gigs exist', async () => {
    const page = makePage();
    mockHttpGet.mockResolvedValueOnce({ data: page });

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE, apiKey: API_KEY });
    const result = await client.getGigs({ limit: 20 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.data).toHaveLength(0);
      expect(result.data.nextCursor).toBeNull();
      expect(result.data.hasMore).toBe(false);
    }
  });

  it('sends cursor, limit, status, depositor and beneficiary as query params', async () => {
    const page = makePage();
    mockHttpGet.mockResolvedValueOnce({ data: page });

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE });
    await client.getGigs({
      cursor: 'abc123',
      limit: 10,
      status: 'active',
      depositor: 'G' + 'A'.repeat(55),
      beneficiary: 'G' + 'B'.repeat(55),
    });

    const [_path, options] = mockHttpGet.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(options.params.cursor).toBe('abc123');
    expect(options.params.limit).toBe('10');
    expect(options.params.status).toBe('active');
    expect(options.params.depositor).toBe('G' + 'A'.repeat(55));
    expect(options.params.beneficiary).toBe('G' + 'B'.repeat(55));
  });

  it('caps limit at 100 regardless of what the caller passes', async () => {
    mockHttpGet.mockResolvedValueOnce({ data: makePage() });

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE });
    await client.getGigs({ limit: 500 });

    const [_path, options] = mockHttpGet.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(options.params.limit).toBe('100');
  });

  it('passes apiKey into shared API client creation', async () => {
    mockHttpGet.mockResolvedValueOnce({ data: makePage() });

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE, apiKey: API_KEY });
    await client.getGigs();

    expect(jest.mocked(createApiHttpClient)).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: API_BASE, apiKey: API_KEY }),
    );
  });

  it('traverses multiple pages using nextCursor', async () => {
    const ADDR_A = 'G' + 'A'.repeat(55);
    const page1: GigsPage = {
      data: [{ id: 'esc-1', params: { depositor: ADDR_A, beneficiary: ADDR_A, amountXLM: '10' }, status: 'active', createdAt: 1 }],
      nextCursor: 'cursor-page-2',
      hasMore: true,
    };
    const page2: GigsPage = {
      data: [{ id: 'esc-2', params: { depositor: ADDR_A, beneficiary: ADDR_A, amountXLM: '20' }, status: 'pending', createdAt: 2 }],
      nextCursor: null,
      hasMore: false,
    };

    mockHttpGet
      .mockResolvedValueOnce({ data: page1 })
      .mockResolvedValueOnce({ data: page2 });

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE });

    const result1 = await client.getGigs();
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;
    expect(result1.data.nextCursor).toBe('cursor-page-2');

    const result2 = await client.getGigs({ cursor: result1.data.nextCursor! });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.data.nextCursor).toBeNull();
    expect(result2.data.hasMore).toBe(false);
    expect(mockHttpGet).toHaveBeenCalledTimes(2);
  });

  it('returns mapped HTTP errors from transport helper', async () => {
    mockHttpGet.mockRejectedValueOnce(new Error('HTTP 401: Unauthorized'));

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE });
    const result = await client.getGigs();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Network error/);
    }
  });

  it('returns a network error when transport throws', async () => {
    mockHttpGet.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE });
    const result = await client.getGigs();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Network error/);
    }
  });

  it('creates API client with endpoint base URL', async () => {
    mockHttpGet.mockResolvedValueOnce({ data: makePage() });

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE });
    await client.getGigs();

    expect(jest.mocked(createApiHttpClient)).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: API_BASE }),
    );
  });

  it("validates and serializes date-range, token, amount and sort filters (#235)", async () => {
    mockHttpGet.mockResolvedValueOnce({ data: makePage() });

    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const later = new Date("2026-02-01T00:00:00.000Z");
    const token = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

    const result = await client.getGigs({
      createdAfter: now,
      createdBefore: later,
      tokenAddress: token,
      minAmount: 1000000n,
      maxAmount: "5000000",
      sortBy: "amount",
      sortOrder: "desc",
    });

    expect(result.ok).toBe(true);
    const [_path, options] = mockHttpGet.mock.calls[0] as [string, { params: Record<string, string> }];
    expect(options.params.createdAfter).toBe(now.toISOString());
    expect(options.params.createdBefore).toBe(later.toISOString());
    expect(options.params.tokenAddress).toBe(token);
    expect(options.params.minAmount).toBe("1000000");
    expect(options.params.maxAmount).toBe("5000000");
    expect(options.params.sortBy).toBe("amount");
    expect(options.params.sortOrder).toBe("desc");
  });

  it("rejects invalid limit, depositor, or tokenAddress (#235)", async () => {
    const client = new TrustFlowEscrowClient({ ...BASE_CONTRACT_CONFIG, apiBaseUrl: API_BASE });

    const resNegLimit = await client.getGigs({ limit: -5 });
    expect(resNegLimit.ok).toBe(false);
    expect(resNegLimit.error).toContain("positive integer");

    const resZeroLimit = await client.getGigs({ limit: 0 });
    expect(resZeroLimit.ok).toBe(false);

    const resBadDep = await client.getGigs({ depositor: "invalid-addr" });
    expect(resBadDep.ok).toBe(false);
    expect(resBadDep.error).toContain("Invalid depositor address");

    const resBadToken = await client.getGigs({ tokenAddress: "not-a-token" });
    expect(resBadToken.ok).toBe(false);
    expect(resBadToken.error).toContain("Invalid tokenAddress");
  });

  it("applies a client-wide timeoutMs from the shared config", async () => {
    mockHttpGet.mockResolvedValueOnce({ data: makePage() });

    const client = new TrustFlowEscrowClient({
      ...BASE_CONTRACT_CONFIG,
      apiBaseUrl: API_BASE,
      timeoutMs: 25_000,
    });
    const result = await client.getGigs();

    expect(result.ok).toBe(true);
    expect(jest.mocked(createApiHttpClient)).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 25_000 }),
    );
  });

  it("lets a per-call timeoutMs override the config value", async () => {
    mockHttpGet.mockResolvedValueOnce({ data: makePage() });

    const client = new TrustFlowEscrowClient({
      ...BASE_CONTRACT_CONFIG,
      apiBaseUrl: API_BASE,
      timeoutMs: 25_000,
    });
    const result = await client.getGigs({}, { timeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    expect(jest.mocked(createApiHttpClient)).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 5_000 }),
    );
  });

});
