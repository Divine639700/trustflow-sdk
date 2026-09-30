import { FeeBumpTransaction, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';
import { TrustFlowError } from '../errors';
import type { Network } from '../types';
import { getFreighter } from '../wallet/freighter';
import { NETWORK_CONFIGS } from './network';

export type SignableTransaction = Transaction | FeeBumpTransaction;

export interface SignedTransaction {
  xdr: string;
  hash: string;
}

export interface SignWithFreighterOptions {
  /** Public key (G...) whose signature must appear on the returned envelope. */
  expectedSigner?: string;
}

/** Wallets report the public network as `PUBLIC`; the SDK calls it `MAINNET`. */
function normalizeWalletNetwork(name: string): string {
  const upper = name.toUpperCase();
  return upper === 'PUBLIC' ? 'MAINNET' : upper;
}

/**
 * Asks Freighter to sign `transaction` and verifies the wallet's answer before
 * returning it: the envelope must parse, be the same kind of transaction with
 * the same hash, carry more signatures than the original, and (when
 * `options.expectedSigner` is set) include a valid signature from that account.
 *
 * @param transaction - The transaction to sign
 * @param network - Network the transaction was built for; the wallet must be on it too
 * @param options - Optional `expectedSigner` public key to verify
 * @throws {TrustFlowError} `UNAUTHORIZED` when no wallet is available, `SIGNING_ERROR`
 *   (with the original error as `cause` where there is one) for a network mismatch,
 *   a rejected or failed wallet request, or a response that does not verify
 */
export async function signWithFreighter(
  transaction: SignableTransaction,
  network: Network,
  options: SignWithFreighterOptions = {},
): Promise<SignedTransaction> {
  const freighter = getFreighter();
  if (!freighter) {
    throw new TrustFlowError('Freighter wallet not available', 'UNAUTHORIZED');
  }

  if (transaction.networkPassphrase !== NETWORK_CONFIGS[network].passphrase) {
    throw TrustFlowError.signingFailed(
      `transaction was built for a different network than ${network}`,
    );
  }

  let signedXDR: string;
  try {
    const walletNetwork = await freighter.getNetwork();
    if (walletNetwork && normalizeWalletNetwork(walletNetwork) !== network) {
      throw TrustFlowError.signingFailed(`wallet is on ${walletNetwork}, expected ${network}`);
    }
    ({ signedXDR } = await freighter.signTransaction(transaction.toEnvelope().toXDR('base64'), {
      network,
    }));
  } catch (e) {
    if (e instanceof TrustFlowError) {
      throw e;
    }
    throw TrustFlowError.signingFailed(e instanceof Error ? e.message : String(e), e);
  }

  let signed: SignableTransaction;
  try {
    signed = TransactionBuilder.fromXDR(signedXDR, transaction.networkPassphrase);
  } catch (e) {
    throw TrustFlowError.signingFailed('wallet returned an invalid transaction envelope', e);
  }

  if (signed instanceof FeeBumpTransaction !== transaction instanceof FeeBumpTransaction) {
    throw TrustFlowError.signingFailed('wallet returned a different kind of transaction');
  }
  const hash = signed.hash();
  if (!hash.equals(transaction.hash())) {
    throw TrustFlowError.signingFailed('wallet returned a different transaction than requested');
  }
  if (signed.signatures.length <= transaction.signatures.length) {
    throw TrustFlowError.signingFailed('wallet did not add a signature');
  }

  if (options.expectedSigner) {
    const signer = Keypair.fromPublicKey(options.expectedSigner);
    const existing = new Set(transaction.signatures.map((s) => s.signature().toString('base64')));
    const added = signed.signatures.filter((s) => !existing.has(s.signature().toString('base64')));
    if (!added.some((s) => signer.verify(hash, s.signature()))) {
      throw TrustFlowError.signingFailed(
        `no new signature from expected signer ${options.expectedSigner}`,
      );
    }
  }

  return { xdr: signedXDR, hash: hash.toString('hex') };
}

/**
 * Signs an arbitrary message with a raw Stellar Keypair (Node.js/CLI environments).
 *
 * This produces a raw ed25519 signature over the UTF-8 message bytes, base64-encoded,
 * which matches the format expected by the TrustFlow backend's
 * `Keypair.fromPublicKey(address).verify(Buffer.from(challenge, 'utf-8'), Buffer.from(signature, 'base64'))`.
 *
 * @param keypair - The Stellar Keypair to sign with
 * @param message - The message to sign as a UTF-8 string
 * @returns Base64-encoded ed25519 signature
 */
export function signMessageWithKeypair(keypair: Keypair, message: string): string {
  const messageBytes = Buffer.from(message, 'utf-8');
  const signature = keypair.sign(messageBytes);
  return signature.toString('base64');
}

/**
 * Signs an arbitrary message using the Freighter wallet.
 *
 * This produces a raw ed25519 signature over the UTF-8 message bytes, base64-encoded,
 * which matches the format expected by the TrustFlow backend.
 *
 * @param message - The message to sign as a UTF-8 string
 * @returns Base64-encoded ed25519 signature
 * @throws {TrustFlowError} `UNAUTHORIZED` when no wallet is available, `SIGNING_ERROR` for signing failures
 */
export async function signMessageWithFreighter(message: string): Promise<string> {
  const freighter = getFreighter();
  if (!freighter) {
    throw new TrustFlowError('Freighter wallet not available', 'UNAUTHORIZED');
  }

  try {
    return await freighter.signMessage(message);
  } catch (e) {
    throw TrustFlowError.signingFailed(e instanceof Error ? e.message : String(e), e);
  }
}
