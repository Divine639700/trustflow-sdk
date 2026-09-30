import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { readContractState } from '../../src/contract/read';
import { simulateContractCall } from '../../src/contract/simulate';
import { fetchAccountInfo } from '../../src/stellar/account';
import { TransactionPipeline } from '../../src/tx-pipeline';
import {
  createE2EClient,
  createFundedAccount,
  eventually,
  useE2ENetwork,
  waitForNetwork,
} from './support/network';

// Covers the readiness wait (180s) plus funding two accounts.
const SETUP_TIMEOUT_MS = 240_000;
const TRANSFER_STROOPS = 10_000_000n; // 1 XLM

useE2ENetwork();

describe('TrustFlow SDK against a live Stellar network', () => {
  const client = createE2EClient();
  let sender: Keypair;
  let recipient: Keypair;

  beforeAll(async () => {
    await waitForNetwork();
    sender = await createFundedAccount();
    recipient = await createFundedAccount();
  }, SETUP_TIMEOUT_MS);

  it('TrustFlowClient.getBalance returns the funded native balance', async () => {
    const balance = await eventually(() => client.getBalance(sender.publicKey(), { skipCache: true }));

    expect(balance).toMatch(/^\d+\.\d{7}$/);
    expect(Number(balance)).toBeGreaterThan(0);
  });

  it('fetchAccountInfo reports funded and unfunded accounts', async () => {
    const funded = await eventually(async () => {
      const info = await fetchAccountInfo(sender.publicKey(), 'TESTNET');
      if (!info.isActive) throw new Error('account not yet visible on Horizon');
      return info;
    });

    expect(funded.address).toBe(sender.publicKey());
    expect(Number(funded.balanceXLM)).toBeGreaterThan(0);
    expect(funded.sequenceNumber).toMatch(/^\d+$/);

    const unfunded = await fetchAccountInfo(Keypair.random().publicKey(), 'TESTNET');
    expect(unfunded.isActive).toBe(false);
  });

  it('readContractState reads the native asset contract', async () => {
    const symbol = await readContractState(client, 'symbol');
    expect(symbol).toBe('native');

    const balance = await readContractState(client, 'balance', [
      new Address(sender.publicKey()).toScVal(),
    ]);
    expect(typeof balance).toBe('bigint');
    expect(balance as bigint).toBeGreaterThan(0n);
  });

  it('simulateContractCall simulates a read-only invocation', async () => {
    const account = await client.getSorobanServer().getAccount(sender.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: client.getNetworkPassphrase(),
    })
      .addOperation(
        new Contract(client.contractId).call('balance', new Address(sender.publicKey()).toScVal()),
      )
      .setTimeout(30)
      .build();

    const result = await simulateContractCall(client, tx.toXDR());

    expect(result.success).toBe(true);
    expect(typeof result.returnValue).toBe('bigint');
  });

  it('TransactionPipeline assembles, simulates, signs, submits and confirms a transfer', async () => {
    const before = (await readContractState(client, 'balance', [
      new Address(recipient.publicKey()).toScVal(),
    ])) as bigint;

    const pipeline = new TransactionPipeline(client);
    const result = await pipeline.run({
      sourceAccount: sender.publicKey(),
      operations: [
        new Contract(client.contractId).call(
          'transfer',
          new Address(sender.publicKey()).toScVal(),
          new Address(recipient.publicKey()).toScVal(),
          nativeToScVal(TRANSFER_STROOPS, { type: 'i128' }),
        ),
      ],
      signers: [sender],
      submit: { pollAttempts: 30, pollIntervalMs: 1_000 },
    });

    if (!result.ok) {
      throw new Error(`pipeline failed: ${result.error.code} ${result.error.message}`);
    }
    expect(result.data.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data.feeBumped).toBe(false);

    expect(result.data.ledger).toBeGreaterThan(0);

    const after = (await readContractState(client, 'balance', [
      new Address(recipient.publicKey()).toScVal(),
    ])) as bigint;
    expect(after - before).toBe(TRANSFER_STROOPS);
  });
});
