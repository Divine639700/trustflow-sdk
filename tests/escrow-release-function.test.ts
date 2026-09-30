import { Keypair } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../src/client';
import { releaseEscrow } from '../src/escrow/release';
import { TrustFlowError } from '../src/errors';
import type { ReleaseEscrowParams } from '../src/types';

const CALLER = Keypair.random().publicKey();
const client = {} as TrustFlowClient;

describe('releaseEscrow', () => {
  it('accepts ReleaseEscrowParams from the public top-level types module', async () => {
    const params: ReleaseEscrowParams = {
      escrowId: 'escrow-1',
      caller: CALLER,
    };

    const txId = await releaseEscrow(client, params);

    expect(typeof txId).toBe('string');
    expect(txId.length).toBeGreaterThan(0);
  });

  it('rejects a missing escrowId with a validation error', async () => {
    const promise = releaseEscrow(client, { escrowId: '', caller: CALLER });

    await expect(promise).rejects.toBeInstanceOf(TrustFlowError);
    await expect(promise).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a missing caller with an unauthorized error', async () => {
    const promise = releaseEscrow(client, { escrowId: 'escrow-1', caller: '' });

    await expect(promise).rejects.toBeInstanceOf(TrustFlowError);
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
