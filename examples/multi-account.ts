/**
 * Multi-account usage.
 *
 * Run with: npm run examples:multi-account
 *
 * Shows the four things multi-account support is for:
 *
 *  1. Register several accounts on one client, and switch between them with a
 *     single field write — no second client, no reconnection.
 *  2. Target a specific account for one call without disturbing the active one.
 *  3. Keep per-account state isolated (session token, cached balance, `data`).
 *  4. Persist and restore the account set across reloads.
 *
 * Nothing here contacts the network: every `fetchAccountInfo` is served by the
 * local stub, so the example runs offline and deterministically.
 */

import { TrustFlowClient, TrustFlowError } from '../src';
import type { AccountChangeEvent, Network } from '../src';

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const ALICE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const BOB = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR';
const CAROL = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

const balances: Record<string, string> = {
  [ALICE]: '125.5000000',
  [BOB]: '0.0000000',
  [CAROL]: '42.0000000',
};

/** Stands in for Horizon so the example needs no network. */
function stubFetchAccountInfo(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
    const address = url.slice(url.lastIndexOf('/') + 1);
    const balance = balances[address];
    if (balance === undefined) {
      return { ok: false, status: 404, headers: { get: () => null } } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        balances: [{ asset_type: 'native', balance }],
        sequence: '1000',
      }),
    } as unknown as Response;
  }) as typeof fetch;
}

function heading(text: string): void {
  console.log(`\n=== ${text} ===`);
}

async function main(): Promise<void> {
  stubFetchAccountInfo();

  // ---------------------------------------------------------------------------
  heading('1. Register several accounts on one client');

  const client = new TrustFlowClient({
    contractId: CONTRACT_ID,
    network: 'TESTNET' as Network,
    // A single retry budget covering Horizon, Soroban RPC and backend calls.
    retry: { retries: 2, retryDelayMs: 200, maxRetryDelayMs: 2_000 },
    accounts: [
      { id: 'alice', address: ALICE, label: 'Alice', roles: ['depositor'] },
      { id: 'bob', address: BOB, label: 'Bob', roles: ['beneficiary'] },
      { id: 'carol', address: CAROL, label: 'Carol (arbitrator)', roles: ['arbitrator'] },
    ],
  });

  // The first registered account is active; the Horizon server, the Soroban RPC
  // server and the retry budget are all shared and already warm.
  console.log('active:', client.activeAccount?.id);
  for (const account of client.accounts.list()) {
    console.log(
      `  ${account.id.padEnd(6)} ${account.label ?? ''} roles=${account.roles.join(',')}`,
    );
  }

  // ---------------------------------------------------------------------------
  heading('2. Switch accounts — no reinitialisation, no reconnect');

  const horizonBefore = client.getServer();
  const sorobanBefore = client.getSorobanServer();

  client.useAccount('bob');
  console.log('active:', client.activeAccount?.id, '→', (await client.getAccountInfo()).isActive);

  console.assert(client.getServer() === horizonBefore, 'Horizon connection was rebuilt');
  console.assert(client.getSorobanServer() === sorobanBefore, 'Soroban connection was rebuilt');
  console.log('connections reused:', client.getServer() === horizonBefore);

  // ---------------------------------------------------------------------------
  heading('3. Target one account for a single call');

  // Reads Carol's balance without switching: the active account stays Bob.
  const carol = await client.getAccountInfo({ account: 'carol' });
  console.log('carol balance:', carol.balanceXLM, '| active is still:', client.activeAccount?.id);

  // `asAccount` scopes a block of calls and restores the previous selection,
  // even if the block throws.
  const snapshot = await client.asAccount('alice', async () => ({
    balance: (await client.getAccountInfo()).balanceXLM,
    session: client.getSession(),
  }));
  console.log('alice snapshot:', snapshot, '| active is still:', client.activeAccount?.id);

  // ---------------------------------------------------------------------------
  heading('4. Per-account state is isolated');

  client.setSession('token-for-alice', { account: 'alice' });
  client.setSession('token-for-bob', { account: 'bob' });
  console.log('alice session token:', client.getSession({ account: 'alice' })?.token);
  console.log('bob session token:  ', client.getSession({ account: 'bob' })?.token);

  client.clearSession({ account: 'bob' });
  console.log('after clearing bob →', {
    alice: client.getSession({ account: 'alice' })?.token,
    bob: client.getSession({ account: 'bob' }),
  });

  // Per-account API keys override the client-wide one, and the selected account
  // is identified on the request.
  client.accounts.update('carol', { apiKey: 'carol-backend-token' });
  const headers = client.getAuthHeaders({ account: 'carol' });
  console.log('carol request headers:', {
    account: headers['X-TrustFlow-Account'],
    authorization: headers['Authorization'],
  });

  // Caller-owned per-account state.
  client.accounts.setData('alice', 'openTab', 'deposits');
  client.accounts.setData('bob', 'openTab', 'jobs');
  console.log('tabs:', {
    alice: client.accounts.getData('alice', 'openTab'),
    bob: client.accounts.getData('bob', 'openTab'),
  });

  // ---------------------------------------------------------------------------
  heading('5. React to account changes');

  const unsubscribe = client.onAccountChange((event: AccountChangeEvent) => {
    console.log(`  event: ${event.type}`);
  });
  client.addAccount({ address: ALICE, id: 'alice-signer', label: 'Alice (hardware signer)' });
  client.useAccount('alice-signer');
  console.log('active now:', client.activeAccount?.label);
  unsubscribe();

  // ---------------------------------------------------------------------------
  heading('6. Unknown accounts fail loudly');

  try {
    await client.getAccountInfo({ account: 'dave' });
  } catch (error) {
    if (error instanceof TrustFlowError) {
      console.log(`${error.code}: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  heading('7. Persist and restore the account set');

  const snapshotState = client.accounts.exportState();
  const restoredClient = new TrustFlowClient({ contractId: CONTRACT_ID });
  restoredClient.accounts.importState(snapshotState);
  console.log(
    'restored:',
    restoredClient.accounts.list().map((a) => a.id),
    '| active:',
    restoredClient.activeAccount?.id,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
