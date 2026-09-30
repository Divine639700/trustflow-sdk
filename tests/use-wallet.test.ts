/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useWallet } from '../src/hooks/useWallet';
import { connectWallet, disconnectWallet } from '../src/wallet/connect';
import type { WalletConnection } from '../src/wallet/types';

jest.mock('../src/wallet/connect', () => ({
  connectWallet: jest.fn(),
  disconnectWallet: jest.fn(),
}));

const mockConnect = connectWallet as jest.Mock;
const mockDisconnect = disconnectWallet as jest.Mock;

const connection: WalletConnection = { type: 'freighter', publicKey: 'GA', network: 'TESTNET' };

describe('useWallet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts disconnected', () => {
    const { result } = renderHook(() => useWallet());

    expect(result.current.wallet).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isRejected).toBe(false);
    expect(result.current.isConnected).toBe(false);
  });

  it('connects with freighter by default and stores the wallet', async () => {
    mockConnect.mockResolvedValueOnce(connection);
    const { result } = renderHook(() => useWallet());

    let returned: WalletConnection | undefined;
    await act(async () => {
      returned = await result.current.connect();
    });

    expect(mockConnect).toHaveBeenCalledWith('freighter');
    expect(returned).toBe(connection);
    expect(result.current.wallet).toBe(connection);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('passes an explicit wallet type through', async () => {
    mockConnect.mockResolvedValueOnce({ ...connection, type: 'albedo' });
    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect('albedo');
    });

    expect(mockConnect).toHaveBeenCalledWith('albedo');
  });

  it('reports loading while the connection is pending', async () => {
    let resolveConnect: (w: WalletConnection) => void = () => undefined;
    mockConnect.mockReturnValueOnce(
      new Promise<WalletConnection>((resolve) => {
        resolveConnect = resolve;
      }),
    );
    const { result } = renderHook(() => useWallet());

    let pending: Promise<WalletConnection> | undefined;
    act(() => {
      pending = result.current.connect();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveConnect(connection);
      await pending;
    });
    expect(result.current.loading).toBe(false);
  });

  it('sets error, stays disconnected and rethrows when connecting fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Freighter not installed'));
    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow('Freighter not installed');
    });

    expect(result.current.error).toBe('Freighter not installed');
    expect(result.current.wallet).toBeNull();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('stringifies a non-Error rejection', async () => {
    mockConnect.mockRejectedValueOnce('denied');
    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await expect(result.current.connect()).rejects.toBe('denied');
    });

    expect(result.current.error).toBe('denied');
  });

  it('clears a previous error on the next connect attempt', async () => {
    mockConnect.mockRejectedValueOnce(new Error('first failure'));
    mockConnect.mockResolvedValueOnce(connection);
    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow('first failure');
    });
    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isConnected).toBe(true);
  });

  it('clears the wallet on disconnect', async () => {
    mockConnect.mockResolvedValueOnce(connection);
    mockDisconnect.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.isConnected).toBe(true);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(result.current.wallet).toBeNull();
    expect(result.current.isConnected).toBe(false);
  });

  it('flags isRejected when connection is rejected by user and allows immediate retry', async () => {
    mockConnect.mockRejectedValueOnce(new Error('User rejected the request'));
    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow('User rejected the request');
    });

    expect(result.current.isRejected).toBe(true);
    expect(result.current.error).toBe('User rejected the request');
    expect(result.current.wallet).toBeNull();

    // Now retry without page reload
    mockConnect.mockResolvedValueOnce(connection);
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.isRejected).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.wallet).toBe(connection);
    expect(result.current.isConnected).toBe(true);
  });

  it('resets error and isRejected state via reset()', async () => {
    mockConnect.mockRejectedValueOnce(new Error('User rejected'));
    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await expect(result.current.connect()).rejects.toThrow();
    });

    expect(result.current.isRejected).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isRejected).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
