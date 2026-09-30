import {
  Account,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { signWithFreighter } from '../src/wallet';
import { TrustFlowError } from '../src/errors';

const CONTRACT_ID = 'CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD5';

function buildTx(source: Keypair, passphrase = Networks.TESTNET, sequence = '100'): Transaction {
  return new TransactionBuilder(new Account(source.publicKey(), sequence), {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(new Contract(CONTRACT_ID).call('increment'))
    .setTimeout(30)
    .build();
}

function signedXdr(tx: Transaction | FeeBumpTransaction, ...keys: Keypair[]): string {
  const copy = TransactionBuilder.fromXDR(tx.toEnvelope().toXDR('base64'), tx.networkPassphrase);
  copy.sign(...keys);
  return copy.toEnvelope().toXDR('base64');
}

function installWallet(overrides: Record<string, unknown> = {}) {
  const wallet = {
    getPublicKey: jest.fn(),
    getNetwork: jest.fn().mockResolvedValue('TESTNET'),
    signTransaction: jest.fn(),
    ...overrides,
  };
  global.window = { freighter: wallet } as any;
  return wallet;
}

describe('signWithFreighter', () => {
  const originalWindow = global.window;
  const source = Keypair.random();

  afterEach(() => {
    global.window = originalWindow;
  });

  it('returns the wallet-signed envelope with the hash of that envelope', async () => {
    const tx = buildTx(source);
    const wallet = installWallet({
      signTransaction: jest.fn(async (xdr: string) => ({
        signedXDR: signedXdr(TransactionBuilder.fromXDR(xdr, Networks.TESTNET), source),
      })),
    });

    const result = await signWithFreighter(tx, 'TESTNET', { expectedSigner: source.publicKey() });

    expect(wallet.signTransaction).toHaveBeenCalledWith(tx.toEnvelope().toXDR('base64'), {
      network: 'TESTNET',
    });
    const parsed = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);
    expect(parsed.signatures).toHaveLength(1);
    expect(result.hash).toBe(parsed.hash().toString('hex'));
    expect(result.hash).toBe(tx.hash().toString('hex'));
  });

  it('accepts a signed envelope without checking the signer when none is expected', async () => {
    const tx = buildTx(source);
    installWallet({
      signTransaction: jest.fn().mockResolvedValue({ signedXDR: signedXdr(tx, Keypair.random()) }),
    });

    await expect(signWithFreighter(tx, 'TESTNET')).resolves.toMatchObject({
      hash: tx.hash().toString('hex'),
    });
  });

  it('maps the wallet PUBLIC network name to MAINNET', async () => {
    const tx = buildTx(source, Networks.PUBLIC);
    installWallet({
      getNetwork: jest.fn().mockResolvedValue('PUBLIC'),
      signTransaction: jest.fn().mockResolvedValue({ signedXDR: signedXdr(tx, source) }),
    });

    await expect(signWithFreighter(tx, 'MAINNET')).resolves.toMatchObject({
      hash: tx.hash().toString('hex'),
    });
  });

  it('signs a fee-bump transaction', async () => {
    const feeSource = Keypair.random();
    const inner = buildTx(source);
    inner.sign(source);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      '1000',
      inner,
      Networks.TESTNET,
    );
    installWallet({
      signTransaction: jest.fn().mockResolvedValue({ signedXDR: signedXdr(feeBump, feeSource) }),
    });

    const result = await signWithFreighter(feeBump, 'TESTNET', {
      expectedSigner: feeSource.publicKey(),
    });

    expect(result.hash).toBe(feeBump.hash().toString('hex'));
  });

  it('rejects a different kind of transaction than requested', async () => {
    const feeSource = Keypair.random();
    const inner = buildTx(source);
    inner.sign(source);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      '1000',
      inner,
      Networks.TESTNET,
    );
    installWallet({
      signTransaction: jest.fn().mockResolvedValue({ signedXDR: signedXdr(inner, source) }),
    });

    await expect(signWithFreighter(feeBump, 'TESTNET')).rejects.toMatchObject({
      code: 'SIGNING_ERROR',
      message: expect.stringContaining('different kind'),
    });
  });

  it('rejects a signed envelope for a different transaction', async () => {
    const tx = buildTx(source);
    installWallet({
      signTransaction: jest
        .fn()
        .mockResolvedValue({ signedXDR: signedXdr(buildTx(source, Networks.TESTNET, '500'), source) }),
    });

    await expect(signWithFreighter(tx, 'TESTNET')).rejects.toMatchObject({
      code: 'SIGNING_ERROR',
      message: expect.stringContaining('different transaction'),
    });
  });

  it('rejects an envelope with no added signature', async () => {
    const tx = buildTx(source);
    installWallet({
      signTransaction: jest.fn().mockResolvedValue({ signedXDR: signedXdr(tx) }),
    });

    await expect(signWithFreighter(tx, 'TESTNET')).rejects.toMatchObject({
      code: 'SIGNING_ERROR',
      message: expect.stringContaining('did not add a signature'),
    });
  });

  it('rejects a signature that does not belong to the expected signer', async () => {
    const tx = buildTx(source);
    installWallet({
      signTransaction: jest.fn().mockResolvedValue({ signedXDR: signedXdr(tx, Keypair.random()) }),
    });

    await expect(
      signWithFreighter(tx, 'TESTNET', { expectedSigner: source.publicKey() }),
    ).rejects.toMatchObject({
      code: 'SIGNING_ERROR',
      message: expect.stringContaining('expected signer'),
    });
  });

  it('rejects a response that is not a transaction envelope, keeping the cause', async () => {
    const tx = buildTx(source);
    installWallet({ signTransaction: jest.fn().mockResolvedValue({ signedXDR: 'not-xdr' }) });

    const error = await signWithFreighter(tx, 'TESTNET').catch((e) => e);

    expect(error).toBeInstanceOf(TrustFlowError);
    expect(error.code).toBe('SIGNING_ERROR');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('wraps a wallet rejection as SIGNING_ERROR with the original error as cause', async () => {
    const tx = buildTx(source);
    const rejection = new Error('User declined access');
    installWallet({ signTransaction: jest.fn().mockRejectedValue(rejection) });

    const error = await signWithFreighter(tx, 'TESTNET').catch((e) => e);

    expect(error).toBeInstanceOf(TrustFlowError);
    expect(error.code).toBe('SIGNING_ERROR');
    expect(error.cause).toBe(rejection);
  });

  it('wraps a non-Error rejection from the wallet', async () => {
    const tx = buildTx(source);
    installWallet({ signTransaction: jest.fn().mockRejectedValue('locked') });

    const error = await signWithFreighter(tx, 'TESTNET').catch((e) => e);

    expect(error.code).toBe('SIGNING_ERROR');
    expect(error.message).toContain('locked');
    expect(error.cause).toBe('locked');
  });

  it('fails before signing when the wallet is on another network', async () => {
    const tx = buildTx(source);
    const wallet = installWallet({ getNetwork: jest.fn().mockResolvedValue('PUBLIC') });

    await expect(signWithFreighter(tx, 'TESTNET')).rejects.toMatchObject({
      code: 'SIGNING_ERROR',
      message: expect.stringContaining('wallet is on PUBLIC'),
    });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('skips the wallet network check when the wallet reports no network', async () => {
    const tx = buildTx(source);
    installWallet({
      getNetwork: jest.fn().mockResolvedValue(''),
      signTransaction: jest.fn().mockResolvedValue({ signedXDR: signedXdr(tx, source) }),
    });

    await expect(signWithFreighter(tx, 'TESTNET')).resolves.toMatchObject({
      hash: tx.hash().toString('hex'),
    });
  });

  it('fails before signing when the transaction was built for another network', async () => {
    const tx = buildTx(source, Networks.PUBLIC);
    const wallet = installWallet();

    await expect(signWithFreighter(tx, 'TESTNET')).rejects.toMatchObject({
      code: 'SIGNING_ERROR',
    });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('throws UNAUTHORIZED when no wallet is available', async () => {
    global.window = {} as any;

    await expect(signWithFreighter(buildTx(source), 'TESTNET')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
