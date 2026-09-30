import {
  buildCreateEscrowArgs,
  buildReleaseArgs,
  buildDisputeArgs,
} from '../src/contract/build';
import { TrustFlowError } from '../src/errors';
import type { CreateEscrowParams } from '../src/types';

const VALID_ADDR = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER_ADDR = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR';

function createParams(over: Partial<CreateEscrowParams> = {}): CreateEscrowParams {
  return {
    sender: VALID_ADDR,
    recipient: OTHER_ADDR,
    amountStroops: 2_000_000n,
    durationBlocks: 100,
    ...over,
  } as CreateEscrowParams;
}

/**
 * #111 — the three arg builders must reject a malformed address / escrowId with
 * a `TrustFlowError.validation(...)` before touching `new Address(...)`.
 */
describe('build.ts address / id validation (#111)', () => {
  describe('buildCreateEscrowArgs', () => {
    it('accepts valid addresses', () => {
      expect(() => buildCreateEscrowArgs(createParams())).not.toThrow();
    });
    it('rejects an invalid sender with a TrustFlowError', () => {
      expect(() => buildCreateEscrowArgs(createParams({ sender: 'not-an-address' }))).toThrow(
        TrustFlowError,
      );
    });
    it('rejects an invalid recipient with a TrustFlowError', () => {
      expect(() => buildCreateEscrowArgs(createParams({ recipient: 'GXXX' }))).toThrow(
        TrustFlowError,
      );
    });
  });

  describe('buildReleaseArgs', () => {
    it('accepts a valid escrowId + caller', () => {
      expect(() => buildReleaseArgs('esc-1', VALID_ADDR)).not.toThrow();
    });
    it('rejects an empty escrowId', () => {
      expect(() => buildReleaseArgs('', VALID_ADDR)).toThrow(TrustFlowError);
      expect(() => buildReleaseArgs('   ', VALID_ADDR)).toThrow(TrustFlowError);
    });
    it('rejects an invalid caller', () => {
      expect(() => buildReleaseArgs('esc-1', 'nope')).toThrow(TrustFlowError);
    });
  });

  describe('buildDisputeArgs', () => {
    it('accepts a valid escrowId', () => {
      expect(() => buildDisputeArgs('esc-1', 'goods not delivered')).not.toThrow();
    });
    it('rejects an empty escrowId', () => {
      expect(() => buildDisputeArgs('', 'reason')).toThrow(TrustFlowError);
    });
  });

  it('validation errors are TrustFlowError.validation, not a raw @stellar/stellar-sdk error', () => {
    try {
      buildCreateEscrowArgs(createParams({ sender: 'bad' }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TrustFlowError);
      expect((e as TrustFlowError).code).toBe('VALIDATION_ERROR');
    }
  });
});
