import { AxiosError } from 'axios';
import {
  Account,
  Contract,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk';
import { TrustFlowClient } from '../src/client';
import { TrustFlowError } from '../src/errors';
import { TransactionPipeline } from '../src/tx-pipeline';
import { fetchAccountInfo } from '../src/stellar/account';
import { submitTransaction } from '../src/stellar/transaction';
import { withTransientRetry } from '../src/utils/node-retry';
import { toApiErrorMessage } from '../src/utils/http';
import {
  DEFAULT_TIMEOUT_MS,
  axiosTimeoutMs,
  fetchWithTimeout,
  isAxiosTimeoutError,
  withTimeout,
} from '../src/utils/timeout';

const CONTRACT_ID = 'CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD5';
const ALICE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';

/** A minimal fetch Response stand-in; jsdom/undici details are irrelevant here. */
function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function axiosTimeout(ms: number): AxiosError {
  const error = new AxiosError(`timeout of ${ms}ms exceeded`);
  error.code = 'ECONNABORTED';
  return error;
}

describe('TrustFlowError.timedOut', () => {
  it('produces a TIMEOUT error naming the budget', () => {
    const error = TrustFlowError.timedOut(10_000);
    expect(error).toBeInstanceOf(TrustFlowError);
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe('Timed out after 10000ms');
  });

  it('includes the operation context when given', () => {
    const error = TrustFlowError.timedOut(250, 'confirmation polling');
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe('Timed out after 250ms (confirmation polling)');
  });
});

describe('isAxiosTimeoutError / axiosTimeoutMs', () => {
  it('recognises axios timeout rejections', () => {
    expect(isAxiosTimeoutError(axiosTimeout(10_000))).toBe(true);
    expect(axiosTimeoutMs(axiosTimeout(10_000))).toBe(10_000);
  });

  it('rejects other axios and non-axios errors', () => {
    const aborted = new AxiosError('aborted');
    aborted.code = 'ECONNABORTED';
    expect(isAxiosTimeoutError(aborted)).toBe(false);

    const network = new AxiosError('Network Error');
    network.code = 'ERR_NETWORK';
    expect(isAxiosTimeoutError(network)).toBe(false);

    expect(isAxiosTimeoutError(new Error('timeout of 10000ms exceeded'))).toBe(false);
    expect(axiosTimeoutMs(new Error('timeout of 10000ms exceeded'))).toBeUndefined();
  });
});

describe('toApiErrorMessage', () => {
  it('reports an axios timeout distinctly from other transport failures', () => {
    expect(toApiErrorMessage(axiosTimeout(10_000))).toBe('Request timed out after 10000ms');
  });

  it('leaves ordinary network and HTTP errors unchanged', () => {
    const network = new AxiosError('Network Error');
    network.code = 'ERR_NETWORK';
    expect(toApiErrorMessage(network)).toBe('Network error: Network Error');

    const http = new AxiosError('Request failed with status code 500');
    http.response = { status: 500, statusText: 'Internal Server Error' } as never;
    expect(toApiErrorMessage(http)).toBe('HTTP 500: Internal Server Error');
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise wins the race', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1_000, 'test')).resolves.toBe('done');
  });

  it('throws a TIMEOUT TrustFlowError when the deadline wins', async () => {
    const hanging = new Promise(() => {});
    await expect(withTimeout(hanging, 1, 'stalled call')).rejects.toMatchObject({
      name: 'TrustFlowError',
      code: 'TIMEOUT',
      message: 'Timed out after 1ms (stalled call)',
    });
  });

  it('returns the promise unchanged when no timeout is configured', async () => {
    const promise = Promise.resolve('untimed');
    await expect(withTimeout(promise, undefined, 'test')).resolves.toBe('untimed');
  });
});

describe('fetchWithTimeout', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('returns the response when fetch wins the race', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true }));
    const res = await fetchWithTimeout('https://example.com', undefined, 1_000, 'test');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com', {
      signal: expect.any(AbortSignal),
    });
  });

  it('aborts the request and throws TIMEOUT when the deadline fires', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    await expect(
      fetchWithTimeout('https://example.com', undefined, 1, 'horizon.fetch'),
    ).rejects.toMatchObject({
      name: 'TrustFlowError',
      code: 'TIMEOUT',
      message: 'Timed out after 1ms (horizon.fetch)',
    });
  });

  it('forwards the caller init (method, headers, body) alongside the signal', async () => {
    fetchMock.mockResolvedValue(respond(200, {}));
    const init = { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'tx=abc' };
    await fetchWithTimeout('https://example.com', init, 1_000, 'test');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com', {
      ...init,
      signal: expect.any(AbortSignal),
    });
  });

  it('calls plain fetch when no timeout is configured', async () => {
    fetchMock.mockResolvedValue(respond(200, {}));
    await fetchWithTimeout('https://example.com', undefined, undefined, 'test');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com');
  });
});

describe('fetchAccountInfo timeout', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('throws a TIMEOUT error when the fetch deadline fires', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    // retries: 0 so the timeout surfaces after the first attempt.
    await expect(
      fetchAccountInfo(ALICE, 'TESTNET', { retries: 0 }, TESTNET_HORIZON, 1),
    ).rejects.toMatchObject({
      name: 'TrustFlowError',
      code: 'TIMEOUT',
      message: `Timed out after 1ms (horizon.fetchAccountInfo)`,
    });
  });

  it('still succeeds on a response within the deadline', async () => {
    fetchMock.mockResolvedValue(respond(200, { balances: [], sequence: '1' }));
    const info = await fetchAccountInfo(ALICE, 'TESTNET', { retries: 0 }, TESTNET_HORIZON, 1_000);
    expect(info.isActive).toBe(true);
  });
});

describe('submitTransaction timeout', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('throws a TIMEOUT error when the fetch deadline fires', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    await expect(
      submitTransaction('AAAA', TESTNET_HORIZON, { retries: 0 }, 1),
    ).rejects.toMatchObject({
      name: 'TrustFlowError',
      code: 'TIMEOUT',
      message: 'Timed out after 1ms (horizon.submitTransaction)',
    });
  });
});

describe('withTransientRetry timeoutMs', () => {
  it('bounds each attempt and throws TIMEOUT once the budget is spent', async () => {
    const fn = jest.fn(() => new Promise(() => {}));
    await expect(
      withTransientRetry(
        fn,
        { timeoutMs: 1, attempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
        undefined,
        'test.stage',
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    // Both attempts were made before the timeout surfaced.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('resolves normally when attempts stay within the deadline', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(
      withTransientRetry(fn, { timeoutMs: 1_000 }, undefined, 'test.stage'),
    ).resolves.toBe('ok');
  });
});

describe('TrustFlowClient timeoutMs', () => {
  it('exposes the client-wide timeout from config', () => {
    const client = new TrustFlowClient({ contractId: CONTRACT_ID, timeoutMs: 25_000 });
    expect(client.timeoutMs).toBe(25_000);
  });

  it('leaves timeoutMs undefined when not configured', () => {
    const client = new TrustFlowClient({ contractId: CONTRACT_ID });
    expect(client.timeoutMs).toBeUndefined();
  });

  it('leaves the Soroban server untouched when no timeout is configured', () => {
    const client = new TrustFlowClient({ contractId: CONTRACT_ID });
    expect(() => client.getSorobanServer()).not.toThrow();
  });
});

describe('pipeline RPC timeout', () => {
  const keypair = Keypair.random();

  function unsignedTx(): Transaction {
    const account = new Account(keypair.publicKey(), '100');
    const contract = new Contract(CONTRACT_ID);
    return new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('increment'))
      .setTimeout(30)
      .build();
  }

  afterEach(() => jest.restoreAllMocks());

  it('bounds simulate calls by the client-wide timeout and surfaces TIMEOUT', async () => {
    // A simulateTransaction that never resolves: without the timeout the
    // call would hang the test forever.
    jest
      .spyOn(rpc.Server.prototype, 'simulateTransaction')
      .mockImplementation(() => new Promise(() => {}));

    const client = new TrustFlowClient({ contractId: CONTRACT_ID, timeoutMs: 1 });
    const result = await new TransactionPipeline(client).simulate(unsignedTx(), {
      maxAttempts: 1,
      baseDelayMs: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(TrustFlowError);
    expect(result.error.code).toBe('TIMEOUT');
  });
});

describe('TransactionPipeline confirmation deadline', () => {
  function makeClient(): TrustFlowClient {
    return new TrustFlowClient({ contractId: CONTRACT_ID, network: 'TESTNET' });
  }

  function signedTx(): Transaction {
    const keypair = Keypair.random();
    const account = new Account(keypair.publicKey(), '100');
    const contract = new Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call('increment'))
      .setTimeout(30)
      .build();
    tx.sign(keypair);
    return tx;
  }

  function pending(hash = 'deadbeef'): rpc.Api.SendTransactionResponse {
    return { status: 'PENDING', hash, latestLedger: 1, latestLedgerCloseTime: 1 };
  }

  function txStatus(status: rpc.Api.GetTransactionStatus, ledger?: number) {
    return { status, ledger } as unknown as rpc.Api.GetTransactionResponse;
  }

  afterEach(() => jest.restoreAllMocks());

  it('fails with a TIMEOUT error when the overall poll deadline elapses', async () => {
    jest.spyOn(rpc.Server.prototype, 'sendTransaction').mockResolvedValue(pending());
    jest
      .spyOn(rpc.Server.prototype, 'getTransaction')
      .mockResolvedValue(txStatus(rpc.Api.GetTransactionStatus.NOT_FOUND));

    const result = await new TransactionPipeline(makeClient()).submit(signedTx(), {
      pollIntervalMs: 5,
      pollAttempts: 100,
      pollTimeoutMs: 25,
      maxAttempts: 1,
      baseDelayMs: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(TrustFlowError);
    expect(result.error.code).toBe('TIMEOUT');
    expect(result.error.message).toContain('Timed out after 25ms');
  });

  it('confirms normally when the transaction lands within the deadline', async () => {
    jest.spyOn(rpc.Server.prototype, 'sendTransaction').mockResolvedValue(pending());
    jest
      .spyOn(rpc.Server.prototype, 'getTransaction')
      .mockResolvedValue(txStatus(rpc.Api.GetTransactionStatus.SUCCESS, 42));

    const result = await new TransactionPipeline(makeClient()).submit(signedTx(), {
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
      maxAttempts: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ledger).toBe(42);
  });
});

describe('default timeout', () => {
  it('is 10s across the SDK', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });
});
