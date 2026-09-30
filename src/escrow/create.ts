import type { TrustFlowClient } from '../client';
import { EscrowStatus } from '../types';
import type { CreateEscrowParams, Escrow } from '../types';
import { TrustFlowError } from '../errors';
import { ESCROW_MIN_AMOUNT_STROOPS } from '../constants';
import { buildCreateEscrowArgs } from '../contract/build';
import { invokeContract } from '../contract/invoke';

/**
 * Creates a new escrow by invoking `create_escrow` on the TrustFlow contract.
 *
 * Validates the amount against {@link ESCROW_MIN_AMOUNT_STROOPS} and requires
 * both parties before encoding the Soroban call arguments via
 * {@link buildCreateEscrowArgs}.
 *
 * @param client - Configured {@link TrustFlowClient}
 * @param params - Escrow terms: sender, recipient, amount in stroops, duration
 * @returns The newly created {@link Escrow} in {@link EscrowStatus.Pending}
 * @throws {TrustFlowError} `VALIDATION_ERROR` if `amountStroops` is below the
 * minimum, or if either `sender` or `recipient` is missing
 *
 * @example
 * ```typescript
 * const escrow = await createEscrow(client, {
 *   sender: senderAddress,
 *   recipient: recipientAddress,
 *   amountStroops: 10_000_000,
 *   durationBlocks: 1000,
 * });
 * console.log(escrow.id, escrow.status);
 * ```
 */
export async function createEscrow(
  client: TrustFlowClient,
  params: CreateEscrowParams,
): Promise<Escrow> {
  if (params.amountStroops < ESCROW_MIN_AMOUNT_STROOPS) {
    throw TrustFlowError.validation('amountStroops', `Minimum is ${ESCROW_MIN_AMOUNT_STROOPS}`);
  }
  if (!params.sender || !params.recipient) {
    throw TrustFlowError.validation('sender/recipient', 'Both addresses are required');
  }

  const args = buildCreateEscrowArgs({
    sender: params.sender,
    recipient: params.recipient,
    amountStroops: params.amountStroops,
    durationBlocks: params.durationBlocks,
  });

  await invokeContract(client, 'create_escrow', args, params.sender);

  return {
    id: `escrow-${Date.now()}`,
    sender: params.sender,
    recipient: params.recipient,
    amount: params.amountStroops,
    status: EscrowStatus.Pending,
    createdAt: Date.now(),
    metadata: params.metadata,
  };
}
