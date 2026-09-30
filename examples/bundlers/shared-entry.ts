/**
 * Shared entry point for every bundler example.
 *
 * The point of these examples is that this file builds under Webpack 5, Rollup
 * and esbuild with **no** Node polyfill configuration — no
 * `resolve.fallback`, no `ProvidePlugin`, no `node:` alias. It touches every
 * entry point a browser app is likely to use, so a regression that reintroduced
 * a Node-only import into the browser bundle would fail these builds.
 */

import {
  TrustFlowClient,
  TrustFlowError,
  detectFeatures,
  classifyFailure,
  retry,
} from '@trustflow/sdk';
import type { Network } from '@trustflow/sdk';
import { TrustFlowEscrowClient, EscrowBuilder } from '@trustflow/sdk/escrow';
import { connectWallet, isFreighterInstalled } from '@trustflow/sdk/wallet';
import { createApiHttpClient, withTransientRetry } from '@trustflow/sdk/utils';
import { useBalance, useWallet } from '@trustflow/sdk/react';

export interface BrowserAppOptions {
  contractId: string;
  network?: Network;
  apiBaseUrl?: string;
}

export function describeEnvironment(): string {
  const report = detectFeatures();
  if (!report.supported) {
    return `unsupported: ${report.missing.map((f) => f.reason).join('; ')}`;
  }
  return `${report.runtime} runtime, webcrypto ${report.features.find((f) => f.name === 'webcrypto')?.supported}`;
}

export async function bootstrap(options: BrowserAppOptions): Promise<TrustFlowClient> {
  const client = new TrustFlowClient({
    contractId: options.contractId,
    network: options.network ?? 'TESTNET',
    apiBaseUrl: options.apiBaseUrl,
    // One retry budget for every Horizon, Soroban RPC and backend call.
    retry: { retries: 3, retryDelayMs: 250, maxRetryDelayMs: 2_000 },
    // Two accounts in one client, switched with a single field write.
    accounts: [
      {
        address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        label: 'Depositor',
        roles: ['depositor'],
      },
      {
        address: 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR',
        label: 'Beneficiary',
        roles: ['beneficiary'],
      },
    ],
  });

  // Per-account state, isolated by account id.
  await client.getAccountInfo();
  await client.getAccountInfo({
    account: 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR',
  });

  const escrow = new TrustFlowEscrowClient(
    {
      contractId: options.contractId,
      network: options.network ?? 'TESTNET',
      rpcUrl: client.rpcUrl,
      networkPassphrase: client.getNetworkPassphrase(),
    },
    { retry: { retries: 2 } },
  );
  const built = new EscrowBuilder()
    .setDepositor('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
    .setBeneficiary('GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR')
    .setAmount('10')
    .build();
  void built;
  void escrow;

  void isFreighterInstalled();
  void connectWallet;
  void useBalance;
  void useWallet;

  const http = createApiHttpClient({ baseURL: options.apiBaseUrl ?? 'https://api.trustflow.xyz' });
  void http;

  void withTransientRetry(() => Promise.resolve(client.rpcUrl));
  void retry(() => Promise.resolve(1), { attempts: 2, shouldRetry: classifyFailure });
  void TrustFlowError.accountNotFound('unknown').code;

  return client;
}

// Referenced from each bundler config so nothing is tree-shaken away before the
// bundler has had a chance to resolve the imports above.
(globalThis as Record<string, unknown>).__trustflowExample = { bootstrap, describeEnvironment };
