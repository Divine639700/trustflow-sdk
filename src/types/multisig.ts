import type { StellarAddress, EscrowId, TxHash, SDKResult } from './index';

export type MultiSigOperationType = 'release' | 'cancel' | 'dispute';
export type MultiSigOperationStatus = 'pending' | 'ready' | 'submitted' | 'expired';

/**
 * M-of-N multi-sig configuration for a shared backend escrow.
 * `threshold` signers out of `signers.length` must approve before the operation proceeds.
 */
export interface MultiSigConfig {
  escrowId: EscrowId;
  /** M: number of signatures required to meet threshold */
  threshold: number;
  /** N: ordered list of authorised Stellar addresses */
  signers: StellarAddress[];
}

/** A single collected signature entry for a multi-sig operation */
export interface SignatureEntry {
  /** Stellar address of the signer */
  signerAddress: StellarAddress;
  /**
   * XDR envelope produced by this signer — the SDK merges signatures from
   * all collected envelopes into a single submission-ready XDR.
   */
  signedXdr: string;
  addedAt: number;
  /** Whether this signature has been cryptographically verified */
  verified?: boolean;
  /** UNIX timestamp (ms) when the signature was verified */
  verifiedAt?: number;
}

/** Internal state of one pending multi-sig operation */
export interface MultiSigOperation {
  operationId: string;
  escrowId: EscrowId;
  operationType: MultiSigOperationType;
  /** The base (unsigned or partially-signed) XDR envelope */
  unsignedXdr: string;
  networkPassphrase: string;
  collectedSignatures: SignatureEntry[];
  /** M — signatures required before submission */
  threshold: number;
  /** N — full set of authorised signers */
  signers: StellarAddress[];
  status: MultiSigOperationStatus;
  createdAt: number;
  expiresAt?: number;
  /**
   * UNIX timestamp (ms) at which the operation reached a terminal status
   * (`submitted` or `expired`). Used by `MultiSigEscrowClient.prune` to decide
   * when a completed operation may be evicted from memory. Absent while the
   * operation is still `pending`/`ready`.
   */
  terminalAt?: number;
}

/** Parameters for initiating a new multi-sig operation */
export interface InitMultiSigParams {
  escrowId: EscrowId;
  /** Ordered list of authorised signer addresses */
  signers: StellarAddress[];
  /** Number of signatures required (must be ≥ 1 and ≤ signers.length) */
  threshold: number;
  operationType: MultiSigOperationType;
  /** Base transaction XDR to be signed by `threshold` of the listed signers */
  unsignedXdr: string;
  networkPassphrase: string;
  /** Optional UNIX timestamp (ms) after which the operation is considered expired */
  expiresAt?: number;
}

/** Parameters for contributing a signature to an existing operation */
export interface AddSignatureParams {
  operationId: string;
  /** Address of the signer submitting this signature */
  signerAddress: StellarAddress;
  /**
   * Fully signed XDR envelope from this signer.
   * The SDK extracts the new `DecoratedSignature` and merges it into the
   * accumulated envelope without duplicating previously collected signatures.
   */
  signedXdr: string;
}

/** Read-only snapshot of signature-collection progress */
export interface MultiSigStatus {
  operationId: string;
  escrowId: EscrowId;
  operationType: MultiSigOperationType;
  signaturesCollected: number;
  threshold: number;
  /** Full authorised-signer list */
  signersAuthorised: StellarAddress[];
  /** Subset who have already signed */
  signersSigned: StellarAddress[];
  /** Subset who have not yet signed */
  signersRemaining: StellarAddress[];
  /** True when signaturesCollected >= threshold */
  isReady: boolean;
  status: MultiSigOperationStatus;
  createdAt: number;
  expiresAt?: number;
}

/** Result returned after successfully submitting a ready multi-sig transaction */
export interface MultiSigSubmitResult {
  txHash: TxHash;
  operationId: string;
  escrowId: EscrowId;
}

export type InitMultiSigResult = SDKResult<{ operationId: string }>;
export type AddSignatureResult = SDKResult<MultiSigStatus>;
export type GetStatusResult = SDKResult<MultiSigStatus>;
export type SubmitMultiSigResult = SDKResult<MultiSigSubmitResult>;
export type GetXdrResult = SDKResult<{ xdr: string }>;

/**
 * Target abstraction for coordinating multisig operation state across
 * independent signer processes (e.g. backed by the TrustFlow backend's REST
 * API), as recommended in docs/spikes/issue-79-retry-session-multisig.md.
 *
 * Not yet wired into `MultiSigEscrowClient` — that requires backend endpoints
 * that don't exist yet, and would be a breaking (sync -> async) API change.
 * Tracked as a follow-up implementation issue. The client's default,
 * in-process store today is a plain `Map`, which satisfies this shape
 * synchronously.
 */
export interface MultiSigStateStore {
  get(operationId: string): Promise<MultiSigOperation | undefined>;
  set(operationId: string, operation: MultiSigOperation): Promise<void>;
  delete(operationId: string): Promise<void>;
  listByEscrow(escrowId: EscrowId): Promise<MultiSigOperation[]>;
}

/**
 * Snapshot schema version produced by `MultiSigEscrowClient.exportState` and
 * expected by `importState`. Bump this — and give `importState` an explicit
 * migration/rejection path for older versions — if `MultiSigStateSnapshot`'s
 * shape ever changes in a way older snapshots wouldn't satisfy. Versioning
 * this now (even with only one version in existence) means a future schema
 * change doesn't silently misinterpret an older snapshot serialized by an
 * integrator's store; `importState` rejects a mismatched version outright
 * instead of guessing.
 */
export const MULTISIG_SNAPSHOT_VERSION = 1;

/**
 * Serializable snapshot of one multisig operation, for round-tripping state
 * through an external store (e.g. an integrator's own backend) between
 * `MultiSigEscrowClient.exportState` / `importState` calls, ahead of native
 * `MultiSigStateStore` support.
 */
export interface MultiSigStateSnapshot extends MultiSigOperation {
  /** See {@link MULTISIG_SNAPSHOT_VERSION}. */
  version: number;
}

export type ImportStateResult = SDKResult<{ operationId: string }>;
