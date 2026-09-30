/** @jest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react';
import type { TrustFlowClient } from '../src/client';
import { useBalance } from '../src/hooks/useBalance';

function makeClient(getBalance: jest.Mock): TrustFlowClient {
  return { getBalance } as unknown as TrustFlowClient;
}

describe('useBalance', () => {
  it('does not fetch and returns a null balance when address is null', () => {
    const getBalance = jest.fn();
    const { result } = renderHook(() => useBalance(makeClient(getBalance), null));

    expect(getBalance).not.toHaveBeenCalled();
    expect(result.current).toEqual({ balance: null, loading: false, error: null });
  });

  it('is loading until the balance resolves, then exposes it', async () => {
    const getBalance = jest.fn().mockResolvedValue('100.0000000');
    const client = makeClient(getBalance);
    const { result } = renderHook(() => useBalance(client, 'GA'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getBalance).toHaveBeenCalledWith('GA');
    expect(result.current.balance).toBe('100.0000000');
    expect(result.current.error).toBeNull();
  });

  it('exposes the error message when getBalance rejects', async () => {
    const getBalance = jest.fn().mockRejectedValue(new Error('account not found'));
    const client = makeClient(getBalance);
    const { result } = renderHook(() => useBalance(client, 'GA'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('account not found');
    expect(result.current.balance).toBeNull();
  });

  it('refetches when the address changes', async () => {
    const getBalance = jest.fn().mockImplementation(async (address: string) => `${address}-balance`);
    const client = makeClient(getBalance);
    const { result, rerender } = renderHook(({ address }) => useBalance(client, address), {
      initialProps: { address: 'GA' as string | null },
    });

    await waitFor(() => expect(result.current.balance).toBe('GA-balance'));

    rerender({ address: 'GB' });

    await waitFor(() => expect(result.current.balance).toBe('GB-balance'));
    expect(getBalance).toHaveBeenCalledTimes(2);
    expect(getBalance).toHaveBeenLastCalledWith('GB');
  });

  it('clears the balance when the address becomes null', async () => {
    const getBalance = jest.fn().mockResolvedValue('5.0000000');
    const client = makeClient(getBalance);
    const { result, rerender } = renderHook(({ address }) => useBalance(client, address), {
      initialProps: { address: 'GA' as string | null },
    });

    await waitFor(() => expect(result.current.balance).toBe('5.0000000'));

    rerender({ address: null });

    await waitFor(() => expect(result.current.balance).toBeNull());
    expect(getBalance).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale response after the address changed', async () => {
    let resolveFirst: (value: string) => void = () => undefined;
    const getBalance = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce('second');
    const client = makeClient(getBalance);
    const { result, rerender } = renderHook(({ address }) => useBalance(client, address), {
      initialProps: { address: 'GA' as string | null },
    });

    rerender({ address: 'GB' });
    await waitFor(() => expect(result.current.balance).toBe('second'));

    resolveFirst('first');
    await Promise.resolve();

    expect(result.current.balance).toBe('second');
  });

  it('does not update state when unmounted before resolution', async () => {
    let resolveBalance: (value: string) => void = () => undefined;
    const getBalance = jest.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveBalance = resolve;
      }),
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = makeClient(getBalance);
    const { result, unmount } = renderHook(() => useBalance(client, 'GA'));

    unmount();
    resolveBalance('100.0000000');
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.balance).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not report an error after unmount when getBalance rejects', async () => {
    let rejectBalance: (reason: Error) => void = () => undefined;
    const getBalance = jest.fn().mockReturnValue(
      new Promise<string>((_resolve, reject) => {
        rejectBalance = reject;
      }),
    );
    const client = makeClient(getBalance);
    const { result, unmount } = renderHook(() => useBalance(client, 'GA'));

    unmount();
    rejectBalance(new Error('late failure'));
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current.error).toBeNull();
  });
});
