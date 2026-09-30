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
import { TrustFlowError } from '../src/errors';

const NETWORK = Networks.TESTNET;

function makeClient(): any {
  return new MultiSigEscrowClient({ networkPassphrase: NETWORK } as any);
}

/** Builds a signed v1 envelope, the shape the modern SDK produces. */
function signedV1Envelope(): { envelope: xdr.TransactionEnvelope; keypair: Keypair } {
  const keypair = Keypair.random();
  const tx = new TransactionBuilder(new Account(keypair.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  return { envelope: tx.toEnvelope(), keypair };
}

/**
 * Re-wraps a signed v1 envelope's transaction as a legacy v0 envelope, keeping
 * its signatures. This exercises the real XDR shape rather than a stub, which
 * is the point: the previous implementation guessed at that shape.
 */
function signedV0Envelope(): xdr.TransactionEnvelope {
  const { envelope, keypair } = signedV1Envelope();
  const v1 = envelope.v1();
  const v0Tx = new xdr.TransactionV0({
    sourceAccountEd25519: xdr.PublicKey.publicKeyTypeEd25519(keypair.rawPublicKey()).ed25519(),
    fee: v1.tx().fee(),
    seqNum: v1.tx().seqNum(),
    timeBounds: null,
    memo: v1.tx().memo(),
    operations: v1.tx().operations(),
    ext: new xdr.TransactionV0Ext(0),
  });
  return xdr.TransactionEnvelope.envelopeTypeTxV0(
    new xdr.TransactionV0Envelope({ tx: v0Tx, signatures: v1.signatures() }),
  );
}

describe('MultiSigEscrowClient envelope signature handling', () => {
  describe('_extractSignatures', () => {
    it('extracts signatures from a v1 envelope', () => {
      const { envelope } = signedV1Envelope();

      expect(makeClient()._extractSignatures(envelope)).toHaveLength(1);
    });

    it('extracts signatures from a legacy v0 envelope instead of dropping them', () => {
      const envelope = signedV0Envelope();

      expect(envelope.switch()).toBe(xdr.EnvelopeType.envelopeTypeTxV0());
      expect(makeClient()._extractSignatures(envelope)).toHaveLength(1);
    });

    it('still extracts v0 signatures after an XDR round trip', () => {
      const decoded = xdr.TransactionEnvelope.fromXDR(signedV0Envelope().toXDR('base64'), 'base64');

      expect(makeClient()._extractSignatures(decoded)).toHaveLength(1);
    });

    it('throws rather than returning an empty list for an unrecognized envelope type', () => {
      const unknownEnvelope = {
        switch: () => ({ name: 'envelopeTypeSomethingNew' }),
      } as unknown as xdr.TransactionEnvelope;

      expect(() => makeClient()._extractSignatures(unknownEnvelope)).toThrow(TrustFlowError);
      expect(() => makeClient()._extractSignatures(unknownEnvelope)).toThrow(
        /Unsupported transaction envelope type/,
      );
    });
  });

  describe('_setSignatures', () => {
    it('writes signatures back onto a v0 envelope', () => {
      const envelope = signedV0Envelope();
      const { envelope: other } = signedV1Envelope();
      const replacement = other.v1().signatures();

      makeClient()._setSignatures(envelope, replacement);

      expect(envelope.v0().signatures()).toHaveLength(replacement.length);
    });

    it('throws rather than silently discarding signatures for an unrecognized type', () => {
      const unknownEnvelope = {
        switch: () => ({ name: 'envelopeTypeSomethingNew' }),
      } as unknown as xdr.TransactionEnvelope;

      expect(() => makeClient()._setSignatures(unknownEnvelope, [])).toThrow(TrustFlowError);
    });
  });
});
