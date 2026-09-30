import { submitTransaction } from '../src/stellar/transaction';
import type { HorizonSubmissionErrorDetail } from '../src/stellar/transaction';
import { TrustFlowError } from '../src/errors';

const HORIZON = 'https://horizon.example.org';

function respond(status: number, body: string): Response {
  return new Response(body, { status });
}

async function catchError(promise: Promise<unknown>): Promise<TrustFlowError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(TrustFlowError);
    return e as TrustFlowError;
  }
  throw new Error('expected submitTransaction to reject');
}

describe('submitTransaction', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('returns hash, ledger and successful on success', async () => {
    fetchMock.mockResolvedValue(
      respond(200, JSON.stringify({ hash: 'abc', successful: true, ledger: 7 })),
    );
    await expect(submitTransaction('XDR==', HORIZON)).resolves.toEqual({
      hash: 'abc',
      successful: true,
      ledger: 7,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${HORIZON}/transactions`,
      expect.objectContaining({ method: 'POST', body: 'tx=XDR%3D%3D' }),
    );
  });

  it('exposes transaction and operation result codes for tx_failed', async () => {
    fetchMock.mockResolvedValue(
      respond(
        400,
        JSON.stringify({
          title: 'Transaction Failed',
          detail: 'The transaction failed when submitted to the stellar network.',
          extras: { result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] } },
        }),
      ),
    );
    const err = await catchError(submitTransaction('XDR', HORIZON));
    expect(err.code).toBe('SUBMISSION_ERROR');
    expect(err.message).toContain('tx_failed');
    expect(err.message).toContain('op_underfunded');
    expect(err.cause as HorizonSubmissionErrorDetail).toEqual({
      status: 400,
      title: 'Transaction Failed',
      detail: 'The transaction failed when submitted to the stellar network.',
      transactionCode: 'tx_failed',
      operationCodes: ['op_underfunded'],
    });
  });

  it('exposes tx_bad_seq', async () => {
    fetchMock.mockResolvedValue(
      respond(400, JSON.stringify({ extras: { result_codes: { transaction: 'tx_bad_seq' } } })),
    );
    const err = await catchError(submitTransaction('XDR', HORIZON));
    expect((err.cause as HorizonSubmissionErrorDetail).transactionCode).toBe('tx_bad_seq');
    expect((err.cause as HorizonSubmissionErrorDetail).operationCodes).toEqual([]);
  });

  it('retries an HTML 502 as a transient edge failure, then surfaces CONNECTION_ERROR', async () => {
    fetchMock.mockResolvedValue(respond(502, '<html>Bad Gateway</html>'));
    const err = await catchError(
      submitTransaction('XDR', HORIZON, { retries: 1, retryDelayMs: 1, maxRetryDelayMs: 1 }),
    );
    // A 5xx means an edge proxy failed before Horizon reached a verdict, so it
    // is retried; after the budget is spent the caller sees CONNECTION_ERROR.
    expect(err.code).toBe('CONNECTION_ERROR');
    expect(err.message).toContain('502');
    expect((err.cause as { status?: number }).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a Horizon 4xx that carries result codes', async () => {
    fetchMock.mockResolvedValue(
      respond(400, JSON.stringify({ extras: { result_codes: { transaction: 'tx_failed' } } })),
    );
    const err = await catchError(
      submitTransaction('XDR', HORIZON, { retries: 3, retryDelayMs: 1, maxRetryDelayMs: 1 }),
    );
    expect(err.code).toBe('SUBMISSION_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transport failure and succeeds on the next attempt', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        respond(200, JSON.stringify({ hash: 'abc', successful: true, ledger: 7 })),
      );
    await expect(
      submitTransaction('XDR', HORIZON, { retries: 2, retryDelayMs: 1, maxRetryDelayMs: 1 }),
    ).resolves.toEqual({ hash: 'abc', successful: true, ledger: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours a Retry-After header on 429', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(respond(200, JSON.stringify({ hash: 'abc', successful: true })));
    await expect(
      submitTransaction('XDR', HORIZON, {
        retries: 2,
        retryDelayMs: 50_000,
        maxRetryDelayMs: 50_000,
      }),
    ).resolves.toMatchObject({ hash: 'abc' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a TrustFlowError for an invalid JSON success body', async () => {
    fetchMock.mockResolvedValue(respond(200, '{not json'));
    const err = await catchError(submitTransaction('XDR', HORIZON));
    expect(err.code).toBe('SUBMISSION_ERROR');
  });

  it('throws when Horizon reports successful: false', async () => {
    fetchMock.mockResolvedValue(respond(200, JSON.stringify({ hash: 'abc', successful: false })));
    const err = await catchError(submitTransaction('XDR', HORIZON));
    expect(err.code).toBe('SUBMISSION_ERROR');
  });

  it('wraps network failures as CONNECTION_ERROR with the original cause', async () => {
    const original = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(original);
    const err = await catchError(submitTransaction('XDR', HORIZON));
    expect(err.code).toBe('CONNECTION_ERROR');
    expect(err.cause).toBe(original);
  });

  it('strips a trailing slash from the Horizon URL', async () => {
    fetchMock.mockResolvedValue(respond(200, JSON.stringify({ hash: 'abc', successful: true })));
    await submitTransaction('XDR', `${HORIZON}/`);
    expect(fetchMock.mock.calls[0][0]).toBe(`${HORIZON}/transactions`);
  });

  it.each(['not a url', 'ftp://horizon.example.org'])('rejects invalid URL %s', async (url) => {
    const err = await catchError(submitTransaction('XDR', url));
    expect(err.code).toBe('INVALID_CONFIG');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
