/**
 * Example: Raise a dispute on an active escrow
 */
import { TrustFlowClient } from '../src/client';
import { disputeEscrow } from '../src/escrow';
import { connectWallet } from '../src/wallet/connect';

async function main() {
  const wallet = await connectWallet('freighter');
  const client = new TrustFlowClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
  });

  const [,, escrowId, ...reasonWords] = process.argv;
  const reason = reasonWords.join(' ') || 'Goods not delivered as described.';

  const txHash = await disputeEscrow(client, { escrowId, caller: wallet.publicKey, reason });
  console.log('Dispute raised! Transaction:', txHash);
}

main().catch(console.error);
