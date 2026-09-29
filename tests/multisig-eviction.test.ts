import { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { MultiSigEscrowClient } from '../src/escrow/multisig';

describe('MultiSigEscrowClient automatic eviction', () => {
  const NETWORK = Networks.TESTNET;
  const SIGNER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
  // `initMultiSigOperation` validates that the base envelope parses, so this
  // has to be a real transaction rather than a placeholder XDR.
  const XDR = new TransactionBuilder(new Account(SIGNER.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(30)
    .build()
    .toEnvelope()
    .toXDR('base64');

  function makeClient(retentionMs = 1000): MultiSigEscrowClient {
    return new MultiSigEscrowClient(
      { networkPassphrase: NETWORK } as any,
      { retentionMs },
    );
  }

  function initOperation(client: MultiSigEscrowClient, escrowId = 'escrow-1') {
    const result = client.initMultiSigOperation({
      escrowId,
      signers: [SIGNER.publicKey()],
      threshold: 1,
      operationType: 'release',
      unsignedXdr: XDR,
      networkPassphrase: NETWORK,
    });
    expect(result.ok).toBe(true);
    return (result as { ok: true; data: { operationId: string } }).data.operationId;
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('evicts an expired operation once it passes the retention window', () => {
    const client = makeClient(1000);
    const expiresAt = Date.now() + 1000;
    const result = client.initMultiSigOperation({
      escrowId: 'escrow-1',
      signers: [SIGNER.publicKey()],
      threshold: 1,
      operationType: 'release',
      unsignedXdr: XDR,
      networkPassphrase: NETWORK,
      expiresAt,
    });
    expect(result.ok).toBe(true);
    const operationId = (result as { ok: true; data: { operationId: string } }).data.operationId;

    jest.setSystemTime(expiresAt + 1);
    const status = client.getMultiSigStatus(operationId);
    expect(status.ok).toBe(true);
    expect((status as { ok: true; data: { status: string } }).data.status).toBe('expired');

    // Still listed while within the retention window.
    expect(client.listOperations('escrow-1')).toHaveLength(1);

    // After the retention window elapses, the operation is evicted.
    jest.setSystemTime(expiresAt + 1 + 1000 + 1);
    expect(client.listOperations('escrow-1')).toHaveLength(0);
  });

  it('evicts a submitted operation once it passes the retention window', () => {
    const client = makeClient(1000);
    const operationId = initOperation(client);

    // Simulate a completed operation reaching terminal status.
    const op = (client as any).operations.get(operationId);
    op.status = 'submitted';
    op.terminalAt = Date.now();

    expect(client.listOperations('escrow-1')).toHaveLength(1);
    jest.setSystemTime(Date.now() + 1000 + 1);
    expect(client.listOperations('escrow-1')).toHaveLength(0);
  });

  it('does not evict pending or ready operations regardless of elapsed time', () => {
    const client = makeClient(1000);
    const operationId = initOperation(client);

    jest.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect(client.listOperations('escrow-1')).toHaveLength(1);

    const op = (client as any).operations.get(operationId);
    op.status = 'ready';
    op.terminalAt = undefined;
    jest.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect(client.listOperations('escrow-1')).toHaveLength(1);
  });

  it('expose a prune() method that evicts terminal operations explicitly', () => {
    const client = makeClient(1000);
    initOperation(client);

    // Mark the operation as expired at the current time.
    const op = (client as any).operations.get(
      Array.from((client as any).operations.keys())[0],
    );
    op.status = 'expired';
    op.terminalAt = Date.now();

    expect((client as any).operations.size).toBe(1);
    jest.setSystemTime(Date.now() + 1000 + 1);
    client.prune();
    expect((client as any).operations.size).toBe(0);
  });
});
