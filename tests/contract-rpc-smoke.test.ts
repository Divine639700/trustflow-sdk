import { rpc } from '@stellar/stellar-sdk';
import * as contract from '../src/contract';

/**
 * #104 — `src/contract/{invoke,read,simulate}.ts` previously imported a
 * nonexistent `SorobanRpc` from `@stellar/stellar-sdk@15`. They now use `rpc`.
 * This fails immediately if a future SDK bump renames or drops that export,
 * or reintroduces the broken name.
 */
describe('contract-invocation RPC wiring (#104)', () => {
  it('re-exports the invocation functions from src/contract/index.ts', () => {
    expect(typeof contract.invokeContract).toBe('function');
    expect(typeof contract.readContractState).toBe('function');
    expect(typeof contract.simulateContractCall).toBe('function');
  });

  it('the pinned @stellar/stellar-sdk exposes `rpc` and `rpc.Server` constructs', () => {
    expect(rpc).toBeDefined();
    expect(typeof rpc.Server).toBe('function');
    const server = new rpc.Server('https://soroban-testnet.stellar.org');
    expect(server).toBeInstanceOf(rpc.Server);
  });

  it('the old `SorobanRpc` name stays gone', () => {
    const sdk = require('@stellar/stellar-sdk') as Record<string, unknown>;
    expect(sdk.SorobanRpc).toBeUndefined();
    expect(sdk.rpc).toBeDefined();
  });
});
