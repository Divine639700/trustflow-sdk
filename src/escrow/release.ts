import type { TrustFlowClient } from '../client';
import type { ReleaseEscrowParams } from '../types';
import { TrustFlowError } from '../errors';

/**
 * Releases escrowed funds to the recipient.
 *
 * Maps to the contract's `release(escrow_id, caller)` call; the contract
 * enforces that `caller` is permitted to release.
 *
 * @param client - Configured {@link TrustFlowClient}, reserved for the contract
 * call once a live signer is wired in
 * @param params - Release parameters: `escrowId` and `caller`
 * @returns A release transaction identifier. This is currently a locally
 * generated placeholder, not an on-chain hash, until the call is wired to a
 * signer.
 * @throws {TrustFlowError} `VALIDATION_ERROR` if `escrowId` is missing, or
 * `UNAUTHORIZED` if `caller` is missing
 *
 * @example
 * ```typescript
 * const txId = await releaseEscrow(client, {
 *   escrowId: escrow.id,
 *   caller: senderAddress,
 * });
 * console.log('Release submitted:', txId);
 * ```
 */
export async function releaseEscrow(
  client: TrustFlowClient,
  params: ReleaseEscrowParams,
): Promise<string> {
  void client;
  if (!params.escrowId) {
    throw TrustFlowError.validation('escrowId', 'Required');
  }
  if (!params.caller) {
    throw TrustFlowError.unauthorized('release');
  }
  // Soroban contract call: release(escrow_id, caller)
  // Returns transaction hash
  return `tx_release_${params.escrowId}_${Date.now()}`;
}
