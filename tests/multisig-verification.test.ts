import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { MultiSigEscrowClient } from '../src/escrow/multisig';

const NETWORK = Networks.TESTNET;

function makeClient(): MultiSigEscrowClient {
  return new MultiSigEscrowClient({ networkPassphrase: NETWORK } as any);
}

/** Builds an unsigned transaction envelope for testing. */
function buildUnsignedTx(sourceKeypair: Keypair): { xdr: string; keypair: Keypair } {
  const tx = new TransactionBuilder(new Account(sourceKeypair.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
    )
    .setTimeout(30)
    .build();
  return { xdr: tx.toEnvelope().toXDR('base64'), keypair: sourceKeypair };
}

/** Signs a transaction with a keypair and returns the signed XDR. */
function signTx(unsignedXdr: string, signer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, NETWORK);
  tx.sign(signer);
  return tx.toEnvelope().toXDR('base64');
}

/** Creates a signed XDR for a DIFFERENT transaction (different amount). */
function buildDifferentTx(sourceKeypair: Keypair): string {
  const tx = new TransactionBuilder(new Account(sourceKeypair.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '999', // Different amount
      }),
    )
    .setTimeout(30)
    .build();
  tx.sign(sourceKeypair);
  return tx.toEnvelope().toXDR('base64');
}

describe('MultiSigEscrowClient signature verification', () => {
  let client: MultiSigEscrowClient;
  let signerA: Keypair;
  let signerB: Keypair;
  let unsignedXdr: string;
  let operationId: string;

  beforeEach(() => {
    client = makeClient();
    signerA = Keypair.random();
    signerB = Keypair.random();

    const { xdr } = buildUnsignedTx(signerA); // source account doesn't matter for multisig
    unsignedXdr = xdr;

    const initResult = client.initMultiSigOperation({
      escrowId: 'test-escrow',
      signers: [signerA.publicKey(), signerB.publicKey()],
      threshold: 2,
      operationType: 'release',
      unsignedXdr,
      networkPassphrase: NETWORK,
    });
    expect(initResult.ok).toBe(true);
    if (initResult.ok) {
      operationId = initResult.data.operationId;
    }
  });

  describe('addSignature with valid signatures', () => {
    it('accepts a correctly signed envelope from an authorized signer', () => {
      const signedXdr = signTx(unsignedXdr, signerA);

      const result = client.addSignature({
        operationId,
        signerAddress: signerA.publicKey(),
        signedXdr,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.signaturesCollected).toBe(1);
        expect(result.data.signersSigned).toContain(signerA.publicKey());
        expect(result.data.isReady).toBe(false);
      }
    });

    it('marks operation as ready when threshold is met with valid signatures', () => {
      const signedXdrA = signTx(unsignedXdr, signerA);
      const signedXdrB = signTx(unsignedXdr, signerB);

      const resultA = client.addSignature({
        operationId,
        signerAddress: signerA.publicKey(),
        signedXdr: signedXdrA,
      });
      expect(resultA.ok).toBe(true);

      const resultB = client.addSignature({
        operationId,
        signerAddress: signerB.publicKey(),
        signedXdr: signedXdrB,
      });
      expect(resultB.ok).toBe(true);
      if (resultB.ok) {
        expect(resultB.data.signaturesCollected).toBe(2);
        expect(resultB.data.isReady).toBe(true);
        expect(resultB.data.status).toBe('ready');
      }
    });
  });

  describe('addSignature rejects invalid signatures', () => {
    it('rejects an envelope with a different transaction hash', () => {
      // Signer A signs correctly
      const signedXdrA = signTx(unsignedXdr, signerA);
      client.addSignature({ operationId, signerAddress: signerA.publicKey(), signedXdr: signedXdrA });

      // Signer B submits a signature for a DIFFERENT transaction
      const differentXdr = buildDifferentTx(signerB);

      const result = client.addSignature({
        operationId,
        signerAddress: signerB.publicKey(),
        signedXdr: differentXdr,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('different transaction');
      }

      // Status should still show only 1 verified signature
      const status = client.getMultiSigStatus(operationId);
      expect(status.ok).toBe(true);
      if (status.ok) {
        expect(status.data.signaturesCollected).toBe(1);
        expect(status.data.isReady).toBe(false);
      }
    });

    it('rejects an envelope signed by a different key than claimed', () => {
      const signedXdrA = signTx(unsignedXdr, signerA);
      client.addSignature({ operationId, signerAddress: signerA.publicKey(), signedXdr: signedXdrA });

      // Signer B claims to sign, but uses a random key to sign
      const impostor = Keypair.random();
      const impostorSignedXdr = signTx(unsignedXdr, impostor);

      const result = client.addSignature({
        operationId,
        signerAddress: signerB.publicKey(), // Claims to be signerB
        signedXdr: impostorSignedXdr, // But signed by impostor
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The impostor's signature has a different hint, so it won't match signerB's hint
        expect(result.error).toContain('does not contain a signature from');
        expect(result.error).toContain(signerB.publicKey());
      }

      const status = client.getMultiSigStatus(operationId);
      expect(status.ok).toBe(true);
      if (status.ok) {
        expect(status.data.signaturesCollected).toBe(1);
      }
    });

    it('rejects an envelope with no signature from the claimed signer', () => {
      const signedXdrA = signTx(unsignedXdr, signerA);
      client.addSignature({ operationId, signerAddress: signerA.publicKey(), signedXdr: signedXdrA });

      // Signer B submits an envelope that has NO signature from B
      // (just the original unsigned envelope, or one signed only by A again)
      const result = client.addSignature({
        operationId,
        signerAddress: signerB.publicKey(),
        signedXdr: signedXdrA, // This has A's signature, not B's
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('does not contain a signature from');
      }
    });

    it('rejects an envelope with an invalid signature (corrupted)', () => {
      const signedXdrA = signTx(unsignedXdr, signerA);
      client.addSignature({ operationId, signerAddress: signerA.publicKey(), signedXdr: signedXdrA });

      // Create a validly signed envelope by B, then corrupt the signature
      const signedXdrB = signTx(unsignedXdr, signerB);
      const envelope = xdr.TransactionEnvelope.fromXDR(signedXdrB, 'base64');
      const v1 = envelope.v1();
      const sigs = v1.signatures();
      // Corrupt the signature bytes
      const originalSigBytes = sigs[0].signature();
      const corruptedSigBytes = Buffer.from(originalSigBytes);
      for (let i = 0; i < corruptedSigBytes.length; i++) {
        corruptedSigBytes[i] = corruptedSigBytes[i] ^ 0xff; // Flip all bits
      }
      const corruptedSig = new xdr.DecoratedSignature({
        hint: sigs[0].hint(),
        signature: corruptedSigBytes,
      });
      v1.signatures([corruptedSig]);
      const corruptedXdr = envelope.toXDR('base64');

      const result = client.addSignature({
        operationId,
        signerAddress: signerB.publicKey(),
        signedXdr: corruptedXdr,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('invalid');
      }
    });
  });

  describe('getAssembledXdr only includes verified signatures', () => {
    it('assembles XDR with only verified signatures', () => {
      const signedXdrA = signTx(unsignedXdr, signerA);
      client.addSignature({ operationId, signerAddress: signerA.publicKey(), signedXdr: signedXdrA });

      const assembled = client.getAssembledXdr(operationId);
      expect(assembled.ok).toBe(true);
      if (assembled.ok) {
        // Verify the assembled XDR has A's signature
        const assembledTx = TransactionBuilder.fromXDR(assembled.data.xdr, NETWORK);
        expect(assembledTx.signatures.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('fails if no verified signatures exist', () => {
      // Try to assemble before any signatures
      const assembled = client.getAssembledXdr(operationId);
      expect(assembled.ok).toBe(false);
      if (!assembled.ok) {
        expect(assembled.error).toContain('No verified signatures');
      }
    });
  });

  describe('submitWhenReady requires verified signatures', () => {
    it('rejects submission if threshold not met with verified signatures', async () => {
      // Only 1 of 2 required signatures
      const signedXdrA = signTx(unsignedXdr, signerA);
      client.addSignature({ operationId, signerAddress: signerA.publicKey(), signedXdr: signedXdrA });

      const result = await client.submitWhenReady(operationId, 'https://horizon-testnet.stellar.org');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('need 1 more verified signature');
      }
    });
  });
});