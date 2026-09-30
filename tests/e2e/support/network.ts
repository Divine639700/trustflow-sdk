import { Asset, Config, Keypair, rpc } from '@stellar/stellar-sdk';
import { TrustFlowClient } from '../../../src/client';
import { HORIZON_URLS, NETWORK_PASSPHRASES, SOROBAN_RPC_URLS } from '../../../src/constants';
import { NETWORK_CONFIGS } from '../../../src/stellar/network';

/**
 * Network under test. Defaults match `stellar/quickstart --local`; override the
 * environment variables to point the suite at testnet instead.
 */
export const E2E = {
  horizonUrl: process.env.E2E_HORIZON_URL ?? 'http://localhost:8000',
  rpcUrl: process.env.E2E_RPC_URL ?? 'http://localhost:8000/rpc',
  friendbotUrl: process.env.E2E_FRIENDBOT_URL ?? 'http://localhost:8000/friendbot',
  passphrase: process.env.E2E_NETWORK_PASSPHRASE ?? 'Standalone Network ; February 2017',
};

const READY_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Points the SDK's `TESTNET` network entry at the network under test. The
 * client and the `stellar/` helpers resolve URLs and the passphrase from these
 * records, so this is the only switch needed to run against another network.
 */
export function useE2ENetwork(): void {
  Config.setAllowHttp(true);
  NETWORK_CONFIGS.TESTNET = {
    horizonUrl: E2E.horizonUrl,
    rpcUrl: E2E.rpcUrl,
    passphrase: E2E.passphrase,
  };
  HORIZON_URLS.TESTNET = E2E.horizonUrl;
  SOROBAN_RPC_URLS.TESTNET = E2E.rpcUrl;
  NETWORK_PASSPHRASES.TESTNET = E2E.passphrase;
}

/** Contract id of the native asset's built-in Stellar Asset Contract. */
export function nativeContractId(): string {
  return Asset.native().contractId(E2E.passphrase);
}

/** Client wired to the network under test and the native Stellar Asset Contract. */
export function createE2EClient(): TrustFlowClient {
  return new TrustFlowClient({
    contractId: nativeContractId(),
    network: 'TESTNET',
    rpcUrl: E2E.rpcUrl,
  });
}

async function poll(name: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (e) {
      lastError = e;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${name} was not ready within ${READY_TIMEOUT_MS}ms: ${String(lastError)}`);
}

/** Waits until Horizon, Soroban RPC (`getHealth`) and friendbot all respond. */
export async function waitForNetwork(): Promise<void> {
  await poll('Horizon', async () => (await fetch(E2E.horizonUrl)).ok);
  await poll('Soroban RPC', async () => {
    const health = await new rpc.Server(E2E.rpcUrl, { allowHttp: true }).getHealth();
    return health.status === 'healthy';
  });
  // Any HTTP response (even a 400 for the missing `addr`) means friendbot is up.
  await poll('friendbot', async () => (await fetch(E2E.friendbotUrl)).status < 500);
}

/** Creates a random keypair and funds it through friendbot. */
export async function createFundedAccount(): Promise<Keypair> {
  const keypair = Keypair.random();
  await poll(`friendbot funding for ${keypair.publicKey()}`, async () => {
    const res = await fetch(`${E2E.friendbotUrl}?addr=${keypair.publicKey()}`);
    return res.ok;
  });
  return keypair;
}

/** Retries an assertion until it passes; Horizon ingests ledgers slightly after RPC. */
export async function eventually<T>(fn: () => Promise<T>, attempts = 15): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      await sleep(1_000);
    }
  }
  throw lastError;
}
