import { TrustFlowError, TrustFlowClient, type TrustFlowErrorCode } from '../src';

describe('TrustFlowError (Unified Error Model)', () => {
  it('instantiates correctly with message and code', () => {
    const code: TrustFlowErrorCode = 'INVALID_CONFIG';
    const err = new TrustFlowError('Invalid config provided', code);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TrustFlowError);
    expect(err.name).toBe('TrustFlowError');
    expect(err.message).toBe('Invalid config provided');
    expect(err.code).toBe('INVALID_CONFIG');
    expect(err.cause).toBeUndefined();
  });

  it('preserves cause when provided', () => {
    const original = new Error('inner');
    const err = new TrustFlowError('Outer error', 'CONNECTION_ERROR', original);
    expect(err.cause).toBe(original);
  });

  it('wraps an existing Error using TrustFlowError.wrap', () => {
    const original = new Error('database connection timeout');
    const wrapped = TrustFlowError.wrap(original, 'NETWORK_ERROR');
    expect(wrapped).toBeInstanceOf(TrustFlowError);
    expect(wrapped.message).toBe('database connection timeout');
    expect(wrapped.code).toBe('NETWORK_ERROR');
    expect(wrapped.cause).toBe(original);
  });

  it('wraps a non-Error string value using TrustFlowError.wrap', () => {
    const wrapped = TrustFlowError.wrap('raw string error message', 'VALIDATION_ERROR');
    expect(wrapped).toBeInstanceOf(TrustFlowError);
    expect(wrapped.message).toBe('raw string error message');
    expect(wrapped.code).toBe('VALIDATION_ERROR');
  });

  it('returns same TrustFlowError instance when wrapping an existing TrustFlowError', () => {
    const original = new TrustFlowError('already a trustflow error', 'UNAUTHORIZED');
    const wrapped = TrustFlowError.wrap(original, 'CONTRACT_ERROR');
    expect(wrapped).toBe(original);
    expect(wrapped.code).toBe('UNAUTHORIZED');
  });

  it('supports instanceof check when thrown by SDK components', () => {
    try {
      new TrustFlowClient({} as any);
      fail('Expected constructor to throw');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(TrustFlowError);
      if (e instanceof TrustFlowError) {
        expect(e.code).toBe('INVALID_CONFIG');
        expect(e.name).toBe('TrustFlowError');
      }
    }
  });

  describe('static factory methods', () => {
    it('creates notFound error', () => {
      const err = TrustFlowError.notFound('Escrow #123');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('Escrow #123 not found');
    });

    it('creates unauthorized error', () => {
      const err = TrustFlowError.unauthorized('release');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.message).toBe('Unauthorized to perform: release');
    });

    it('creates validation error', () => {
      const err = TrustFlowError.validation('amount', 'must be positive');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toBe('Validation failed for amount: must be positive');
    });

    it('creates multiSigThresholdNotMet error', () => {
      const err = TrustFlowError.multiSigThresholdNotMet(1, 2);
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('MULTISIG_THRESHOLD_NOT_MET');
      expect(err.message).toBe('Multi-sig threshold not met: 1/2 signatures collected');
    });

    it('creates multiSigExpired error', () => {
      const err = TrustFlowError.multiSigExpired('op-123');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('MULTISIG_EXPIRED');
      expect(err.message).toBe('Multi-sig operation op-123 has expired');
    });

    it('creates multiSigInvalidSigner error', () => {
      const err = TrustFlowError.multiSigInvalidSigner('GBXYZ');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('MULTISIG_INVALID_SIGNER');
      expect(err.message).toBe('GBXYZ is not an authorised signer for this operation');
    });

    it('creates multiSigXdrError error', () => {
      const err = TrustFlowError.multiSigXdrError('invalid envelope');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('MULTISIG_XDR_ERROR');
      expect(err.message).toBe('Multi-sig XDR error: invalid envelope');
    });

    it('creates assemblyFailed error', () => {
      const cause = new Error('xdr assembly failed');
      const err = TrustFlowError.assemblyFailed('bad params', cause);
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('ASSEMBLY_ERROR');
      expect(err.message).toBe('Transaction assembly failed: bad params');
      expect(err.cause).toBe(cause);
    });

    it('creates simulationFailed error', () => {
      const cause = new Error('rpc fail');
      const err = TrustFlowError.simulationFailed('simulation rejected', cause);
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('SIMULATION_ERROR');
      expect(err.message).toBe('Simulation failed: simulation rejected');
      expect(err.cause).toBe(cause);
    });

    it('creates feeBumpFailed error', () => {
      const cause = new Error('insufficient balance');
      const err = TrustFlowError.feeBumpFailed('cannot sponsor', cause);
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('FEE_BUMP_ERROR');
      expect(err.message).toBe('Fee-bump construction failed: cannot sponsor');
      expect(err.cause).toBe(cause);
    });

    it('creates submissionFailed error', () => {
      const cause = new Error('tx bad seq');
      const err = TrustFlowError.submissionFailed('rpc reject', cause);
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('SUBMISSION_ERROR');
      expect(err.message).toBe('Transaction submission failed: rpc reject');
      expect(err.cause).toBe(cause);
    });

    it('creates retryExhausted error', () => {
      const cause = new Error('timeout');
      const err = TrustFlowError.retryExhausted('submit', 3, cause);
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('RETRY_EXHAUSTED');
      expect(err.message).toBe('Retries exhausted for submit after 3 attempt(s)');
      expect(err.cause).toBe(cause);
    });

    it('creates signingFailed error', () => {
      const cause = new Error('wallet error');
      const err = TrustFlowError.signingFailed('failed to sign', cause);
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('SIGNING_ERROR');
      expect(err.message).toBe('Signing failed: failed to sign');
      expect(err.cause).toBe(cause);
    });

    it('creates userRejected error', () => {
      const err = TrustFlowError.userRejected('User rejected');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('USER_REJECTED');
      expect(err.message).toBe('User rejected');
    });

    it('creates versionMismatch error', () => {
      const err = TrustFlowError.versionMismatch('1.0.0', '2.0.0', 'breaking change');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('VERSION_MISMATCH');
      expect(err.message).toContain('API version mismatch');
    });

    it('creates timedOut error', () => {
      const err = TrustFlowError.timedOut(5000, 'rpc.simulate');
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('TIMEOUT');
      expect(err.message).toBe('Timed out after 5000ms (rpc.simulate)');
    });

    it('creates queueTimeout error', () => {
      const err = TrustFlowError.queueTimeout(3000);
      expect(err).toBeInstanceOf(TrustFlowError);
      expect(err.code).toBe('TIMEOUT');
      expect(err.message).toContain('Timed out after 3000ms');
    });

    it('creates accountNotFound error', () => {
      const err1 = TrustFlowError.accountNotFound('alice');
      expect(err1).toBeInstanceOf(TrustFlowError);
      expect(err1.code).toBe('ACCOUNT_NOT_FOUND');
      expect(err1.message).toContain('alice');

      const err2 = TrustFlowError.accountNotFound();
      expect(err2.code).toBe('ACCOUNT_NOT_FOUND');
      expect(err2.message).toContain('No account context is active');
    });
  });
});
