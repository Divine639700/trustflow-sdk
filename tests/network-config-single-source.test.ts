import { NETWORK_CONFIGS, getNetworkConfig } from '../src/stellar/network';
import { HORIZON_URLS, SOROBAN_RPC_URLS, NETWORK_PASSPHRASES } from '../src/constants';
import { TrustFlowClient } from '../src/client';
import type { Network } from '../src/types';

const NETWORKS: Network[] = ['TESTNET', 'MAINNET'];

/**
 * #109 — network URLs and passphrases are defined exactly once
 * (`NETWORK_CONFIGS`); `src/constants.ts` and `TrustFlowClient` must resolve to
 * the same values by construction.
 */
describe('single-source network config (#109)', () => {
  it('constants derive from NETWORK_CONFIGS', () => {
    for (const network of NETWORKS) {
      expect(HORIZON_URLS[network]).toBe(NETWORK_CONFIGS[network].horizonUrl);
      expect(SOROBAN_RPC_URLS[network]).toBe(NETWORK_CONFIGS[network].rpcUrl);
      expect(NETWORK_PASSPHRASES[network]).toBe(NETWORK_CONFIGS[network].passphrase);
    }
  });

  it('TrustFlowClient.getNetworkPassphrase() reads from the same source', () => {
    for (const network of NETWORKS) {
      const client = new TrustFlowClient({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network,
      });
      expect(client.getNetworkPassphrase()).toBe(NETWORK_CONFIGS[network].passphrase);
    }
  });

  it('getNetworkConfig returns the canonical entry', () => {
    for (const network of NETWORKS) {
      expect(getNetworkConfig(network)).toBe(NETWORK_CONFIGS[network]);
    }
  });

  it('the two networks have distinct, non-empty passphrases', () => {
    expect(NETWORK_CONFIGS.TESTNET.passphrase).not.toBe(NETWORK_CONFIGS.MAINNET.passphrase);
    for (const network of NETWORKS) {
      expect(NETWORK_CONFIGS[network].passphrase.length).toBeGreaterThan(0);
    }
  });
});
