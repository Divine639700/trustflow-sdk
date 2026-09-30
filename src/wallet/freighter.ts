export interface FreighterWallet {
  isAvailable(): boolean;
  getPublicKey(): Promise<string>;
  signTransaction(xdr: string, opts: { network: string }): Promise<{ signedXDR: string }>;
  getNetwork(): Promise<string>;
  /**
   * Signs an arbitrary message (not a transaction) with the wallet's keypair.
   *
   * @param message - The message to sign as a UTF-8 string
   * @returns Base64-encoded ed25519 signature of the UTF-8 message bytes
   */
  signMessage(message: string): Promise<string>;
}

interface FreighterWindow {
  freighter?: {
    getPublicKey(): Promise<string>;
    signTransaction(xdr: string, opts: { network: string }): Promise<{ signedXDR: string }>;
    getNetwork(): Promise<string>;
    signMessage(message: string): Promise<string>;
  };
}

declare const window: FreighterWindow | undefined;

export function getFreighter(): FreighterWallet | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window?.freighter;
  if (!w) {
    return null;
  }
  return {
    isAvailable: () => true,
    getPublicKey: () => w.getPublicKey(),
    signTransaction: (xdr, opts) => w.signTransaction(xdr, opts),
    getNetwork: () => w.getNetwork(),
    signMessage: (message) => w.signMessage(message),
  };
}

export async function isFreighterInstalled(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }
  await new Promise((r) => setTimeout(r, 100));
  return !!window?.freighter;
}
