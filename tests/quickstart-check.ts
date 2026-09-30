import {
  DisputeClient,
  EscrowBuilder,
  EscrowMonitor,
  JurorClient,
  MultiSigEscrowClient,
  ProfileClient,
  TrustFlowClient,
  TrustFlowEscrowClient,
  parseEvents,
} from '@trustflow/sdk';
import type { ContractConfig, RawContractEvent } from '@trustflow/sdk';
import { Networks } from '@stellar/stellar-sdk';

async function connectExample() {
  const client = new TrustFlowClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
  });
  await client.connect();
  return client.getConfig();
}

async function createExample() {
  const escrowClient = new TrustFlowEscrowClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  });
  const params = new EscrowBuilder()
    .setDepositor('GDEPOSITOR...')
    .setBeneficiary('GBENEFICIARY...')
    .setAmount('50')
    .setDeadline(17280)
    .build();
  await escrowClient.createEscrow(params);
  await escrowClient.createEscrow({
    depositor: 'GDEPOSITOR...',
    beneficiary: 'GBENEFICIARY...',
    amountXLM: '50',
    deadlineBlocks: 17280,
  });
}

async function fundExample() {
  const escrowClient = new TrustFlowEscrowClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  });
  await escrowClient.fund('escrow-1234567890', 'GDEPOSITOR...', 500_000_000n, process.env.USDC_CONTRACT_ID);
  await escrowClient.releaseEscrow('escrow-1234567890', 'GDEPOSITOR...');
}

async function balanceExample() {
  const client = new TrustFlowClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
  });
  await client.connect();
  await client.getBalance('GDEPOSITOR...');
}

async function disputeExample() {
  const config: ContractConfig = {
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    apiBaseUrl: process.env.TRUSTFLOW_API_URL!,
    apiKey: process.env.AUTH_TOKEN!,
  };
  const disputes = new DisputeClient(config);
  await disputes.raiseDispute({
    escrowId: 'escrow-1234567890',
    reason: 'Work not delivered as agreed',
    evidence: 'https://evidence.example.com/proof.pdf',
  });
  await disputes.getDispute('escrow-1234567890');
}

async function multisigExample() {
  const client = new MultiSigEscrowClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
  });
  const signers = ['GAPPROVER_A...', 'GAPPROVER_B...'];
  const init = client.initMultiSigOperation({
    escrowId: 'esc-42',
    signers,
    threshold: 2,
    operationType: 'release',
    unsignedXdr: process.env.UNSIGNED_RELEASE_XDR!,
    networkPassphrase: Networks.TESTNET,
  });
  if (!init.ok) throw new Error(init.error);
  const { operationId } = init.data;
  client.addSignature({ operationId, signerAddress: signers[0], signedXdr: process.env.SIGNED_XDR_A! });
  client.addSignature({ operationId, signerAddress: signers[1], signedXdr: process.env.SIGNED_XDR_B! });
  await client.submitWhenReady(operationId, 'https://horizon-testnet.stellar.org');
}

async function listingExample() {
  const escrowClient = new TrustFlowEscrowClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    apiBaseUrl: process.env.TRUSTFLOW_API_URL!,
    apiKey: process.env.API_KEY,
  });
  let cursor: string | undefined;
  do {
    const page = await escrowClient.getGigs({ cursor, limit: 20, status: 'active' });
    if (!page.ok) break;
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor);
}

async function jurorExample() {
  const jurors = new JurorClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  });
  await jurors.vote({
    disputeId: 'dsp-1',
    jurorAddress: 'GJUROR...',
    vote: { encrypted: false, choice: 'approve' },
  });
}

async function profileExample() {
  const profiles = new ProfileClient(process.env.TRUSTFLOW_API_URL!, process.env.AUTH_TOKEN!);
  await profiles.getProfile('GUSER...');
}

async function storageAndEventsExample(fileBuffer: Buffer, rawEvents: RawContractEvent[]) {
  const client = new TrustFlowClient({
    contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
    network: 'TESTNET',
    ipfs: { apiKey: process.env.IPFS_API_KEY },
  });
  await client.storage.upload(fileBuffer, { filename: 'evidence.pdf' });
  const events = parseEvents(rawEvents, client.contractId);
  const monitor = new EscrowMonitor();
  monitor.on('escrow.released', (event) => console.log(event.escrowId));
  return events;
}
