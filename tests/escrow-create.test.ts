import { Keypair } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../src/client';
import { ESCROW_MIN_AMOUNT_STROOPS } from '../src/constants';
import { buildCreateEscrowArgs } from '../src/contract/build';
import { invokeContract } from '../src/contract/invoke';
import { createEscrow } from '../src/escrow/create';
import { TrustFlowError } from '../src/errors';
import { EscrowStatus } from '../src/types';
import type { CreateEscrowParams } from '../src/types';

jest.mock('../src/contract/invoke', () => ({ invokeContract: jest.fn() }));

const mockInvoke = invokeContract as jest.Mock;
const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();
const client = { contractId: 'CONTRACT123' } as TrustFlowClient;

function params(over: Partial<CreateEscrowParams> = {}): CreateEscrowParams {
  return {
    sender: SENDER,
    recipient: RECIPIENT,
    amountStroops: ESCROW_MIN_AMOUNT_STROOPS,
    durationBlocks: 100,
    ...over,
  };
}

describe('createEscrow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({ success: true });
  });

  it('rejects an amount below the minimum with a validation error', async () => {
    const promise = createEscrow(client, params({ amountStroops: ESCROW_MIN_AMOUNT_STROOPS - 1n }));

    await expect(promise).rejects.toBeInstanceOf(TrustFlowError);
    await expect(promise).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('accepts an amount exactly at the minimum', async () => {
    await expect(
      createEscrow(client, params({ amountStroops: ESCROW_MIN_AMOUNT_STROOPS })),
    ).resolves.toBeDefined();
  });

  it.each<[string, Partial<CreateEscrowParams>]>([
    ['sender', { sender: '' }],
    ['recipient', { recipient: '' }],
  ])('rejects a missing %s with a validation error', async (_field, over) => {
    const promise = createEscrow(client, params(over));

    await expect(promise).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('propagates a validation error for a malformed address', async () => {
    await expect(createEscrow(client, params({ sender: 'GABC' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('forwards create_escrow, the encoded args and the sender as caller to invokeContract', async () => {
    await createEscrow(client, params());

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(
      client,
      'create_escrow',
      buildCreateEscrowArgs({
        sender: SENDER,
        recipient: RECIPIENT,
        amountStroops: ESCROW_MIN_AMOUNT_STROOPS,
        durationBlocks: 100,
      }),
      SENDER,
    );
  });

  it('returns a pending escrow built from the params', async () => {
    const metadata = { title: 'logo design' };

    const escrow = await createEscrow(client, params({ metadata }));

    expect(escrow).toMatchObject({
      sender: SENDER,
      recipient: RECIPIENT,
      amount: ESCROW_MIN_AMOUNT_STROOPS,
      status: EscrowStatus.Pending,
      metadata,
    });
    expect(typeof escrow.id).toBe('string');
  });
});
