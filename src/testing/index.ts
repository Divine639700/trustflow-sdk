import { xdr, nativeToScVal, scValToNative, SorobanDataBuilder } from '@stellar/stellar-sdk';

import type { Escrow, EscrowState, EscrowStatus } from '../types/index';

/**
 * Validates whether a value is a structurally valid Stellar `ScVal` (round-trips through XDR).
 *
 * @param val - The value to test
 * @returns `true` if structurally valid ScVal, `false` otherwise
 *
 * @example
 * ```typescript
 * import { isValidScVal } from "@trustflow/sdk/testing";
 *
 * const scval = nativeToScVal(100n, { type: "i128" });
 * expect(isValidScVal(scval)).toBe(true);
 * ```
 */
export function isValidScVal(val: unknown): boolean {
  try {
    const encoded = (val as xdr.ScVal).toXDR();
    xdr.ScVal.fromXDR(encoded);
    return true;
  } catch {
    return false;
  }
}

/**
 * Custom Jest matcher result for `toBeValidScVal`.
 *
 * @param received - Value to validate against ScVal XDR structure
 * @returns CustomMatcherResult object
 */
export function toBeValidScVal(received: unknown) {
  const pass = isValidScVal(received);
  return {
    pass,
    message: () =>
      pass
        ? 'expected value not to be a structurally valid Stellar ScVal'
        : 'expected value to be a structurally valid Stellar ScVal (XDR round-trip failed)',
  };
}

/** Configuration options for `createMockHorizonServer`. */
export interface MockHorizonServerOptions {
  balanceXLM?: string;
  sequenceNumber?: string;
  txHash?: string;
  baseFee?: number;
}

/**
 * Creates a mock Horizon server instance for offline testing.
 *
 * @param options - Custom configuration overrides for responses
 * @returns A mock `Horizon.Server` compatible instance
 *
 * @example
 * ```typescript
 * import { TrustFlowClient } from "@trustflow/sdk";
 * import { createMockHorizonServer } from "@trustflow/sdk/testing";
 *
 * const horizonServer = createMockHorizonServer({ balanceXLM: "500" });
 * const client = new TrustFlowClient({ contractId: "C...", horizonServer: horizonServer as any });
 * const balance = await client.getBalance("G...");
 * ```
 */
export function createMockHorizonServer(options: MockHorizonServerOptions = {}) {
  const balanceXLM = options.balanceXLM ?? '1000';
  const sequenceNumber = options.sequenceNumber ?? '1';
  const txHash = options.txHash ?? 'mock-horizon-tx-hash-1234567890';
  const baseFee = options.baseFee ?? 100;

  return {
    serverURL: new URL('https://mock-horizon.stellar.org'),
    loadAccount: async (accountId: string) => ({
      id: accountId,
      accountId: () => accountId,
      sequenceNumber: () => sequenceNumber,
      sequence: sequenceNumber,
      balances: [
        {
          asset_type: 'native',
          balance: balanceXLM,
        },
      ],
      incrementSequenceNumber: () => {},
    }),
    submitTransaction: async () => ({
      hash: txHash,
      successful: true,
      ledger: 12345,
    }),
    fetchBaseFee: async () => baseFee,
  };
}

/** Configuration options for `createMockSorobanServer`. */
export interface MockSorobanServerOptions {
  /** Minimum resource fee reported by simulation in stroops (default: "10000") */
  minResourceFee?: string;
  /** CPU instructions reported by simulation (default: "50000") */
  cpuInsns?: string;
  /** Memory bytes reported by simulation (default: "20000") */
  memBytes?: string;
  /** Transaction status returned by getTransaction (default: "SUCCESS") */
  txStatus?: 'SUCCESS' | 'PENDING' | 'FAILED' | 'NOT_FOUND';
  /** Return value ScVal for simulation and getTransaction */
  returnValueScVal?: xdr.ScVal;
  /** Native JS return value to be encoded to ScVal if returnValueScVal is omitted */
  returnValue?: unknown;
  /** Simulated network latency in milliseconds for all RPC requests */
  latencyMs?: number;
  /** Network or transport error to throw on RPC requests */
  error?: Error | string | null;
  /** Soroban simulation error message (triggers rpc.Api.isSimulationError) */
  simulationError?: string | null;
  /** Whether simulation requires restore preamble (triggers rpc.Api.isSimulationRestore) */
  simulationRestore?: boolean;
  /** Pre-canned escrow fixtures indexed by escrow ID or numeric ID */
  escrows?: Record<string | number, any> | Map<string | number, any>;
  /** Custom contract method handlers for mock simulation */
  methodHandlers?: Record<string, (args: any[]) => any>;
  /** Custom events list for getEvents */
  events?: any[];
  /** Latest ledger sequence number (default: 1000) */
  latestLedger?: number;
  /** Network passphrase */
  networkPassphrase?: string;
}

/** Mock Soroban RPC server instance returned by `createMockSorobanServer`. */
export interface MockSorobanServer {
  serverURL: URL;
  simulateTransaction: (tx: any) => Promise<any>;
  sendTransaction: (tx: any) => Promise<any>;
  getTransaction: (hash: string) => Promise<any>;
  getEvents: (params?: any) => Promise<any>;
  getLatestLedger: () => Promise<any>;
  getAccount: (accountId: string) => Promise<any>;
  getLedgerEntries: (...keys: any[]) => Promise<any>;
  getHealth: () => Promise<any>;
  getNetwork: () => Promise<any>;
  setLatency: (latencyMs: number) => void;
  setError: (error: Error | string | null) => void;
  clearError: () => void;
  setSimulationError: (error: string | null) => void;
  clearSimulationError: () => void;
  setReturnValue: (val: unknown) => void;
  setReturnValueScVal: (scval: xdr.ScVal) => void;
  setTxStatus: (status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'NOT_FOUND') => void;
  setEscrow: (id: string | number, escrow: any) => void;
  getEscrow: (id: string | number) => any;
  deleteEscrow: (id: string | number) => void;
  registerMethod: (name: string, handler: (args: any[]) => any) => void;
  unregisterMethod: (name: string) => void;
}

function extractInvocation(tx: any): { functionName?: string; args?: any[] } | null {
  try {
    if (!tx || !Array.isArray(tx.operations) || tx.operations.length === 0) return null;
    const op = tx.operations[0];
    if (op.type === 'invokeHostFunction' && op.func) {
      const hf = op.func.invokeContract?.();
      if (hf) {
        const functionName = hf.functionName?.().toString();
        const rawArgs = hf.args?.() ?? [];
        const args = rawArgs.map((arg: any) => {
          try {
            return scValToNative(arg);
          } catch {
            return arg;
          }
        });
        return { functionName, args };
      }
    }
  } catch {
    // If not a standard Transaction or unable to parse, return null
  }
  return null;
}

function toScValHelper(val: unknown): xdr.ScVal {
  if (val instanceof xdr.ScVal) return val;
  if (val === undefined || val === null) return xdr.ScVal.scvVoid();
  if (typeof val === 'boolean') return nativeToScVal(val, { type: 'bool' });
  if (typeof val === 'string') return nativeToScVal(val, { type: 'string' });
  if (typeof val === 'number') return nativeToScVal(val, { type: 'i32' });
  if (typeof val === 'bigint') return nativeToScVal(val, { type: 'i128' });
  if (typeof val === 'object') {
    try {
      return nativeToScVal(val);
    } catch {
      return xdr.ScVal.scvVoid();
    }
  }
  return xdr.ScVal.scvVoid();
}

/**
 * Creates a mock Soroban RPC server instance for offline simulation and invocation tests.
 *
 * Supports pre-canned escrow query responses, custom contract method handlers,
 * simulated network latency, and error injection for offline integration testing.
 *
 * @param options - Simulation, latency, and error configurations
 * @returns A mock `rpc.Server` compatible instance with inspection and mutation helpers
 *
 * @example
 * ```typescript
 * import { TrustFlowClient } from "@trustflow/sdk";
 * import { createMockSorobanServer, buildMockEscrow } from "@trustflow/sdk/testing";
 *
 * const rpcServer = createMockSorobanServer({
 *   escrows: { "1": buildMockEscrow({ id: "1", amount: 10_000_000n }) },
 *   latencyMs: 10,
 * });
 * const client = new TrustFlowClient({ contractId: "C...", rpcServer: rpcServer as any });
 * ```
 */
export function createMockSorobanServer(options: MockSorobanServerOptions = {}): MockSorobanServer {
  let currentMinResourceFee = options.minResourceFee ?? '10000';
  let currentCpuInsns = options.cpuInsns ?? '50000';
  let currentMemBytes = options.memBytes ?? '20000';
  let currentTxStatus = options.txStatus ?? 'SUCCESS';
  let currentLatencyMs = options.latencyMs ?? 0;
  let currentError: Error | string | null = options.error ?? null;
  let currentSimulationError: string | null = options.simulationError ?? null;
  let currentLatestLedger = options.latestLedger ?? 1000;
  let currentNetworkPassphrase =
    options.networkPassphrase ?? 'Test SDF Future Network ; October 2022';

  let currentReturnValueScVal: xdr.ScVal = options.returnValueScVal
    ? options.returnValueScVal
    : options.returnValue !== undefined
      ? toScValHelper(options.returnValue)
      : xdr.ScVal.scvVoid();

  const escrowsMap = new Map<string | number, any>();
  if (options.escrows) {
    if (options.escrows instanceof Map) {
      for (const [k, v] of options.escrows.entries()) {
        escrowsMap.set(k, v);
      }
    } else {
      for (const [k, v] of Object.entries(options.escrows)) {
        escrowsMap.set(k, v);
      }
    }
  }

  const methodHandlers = new Map<string, (args: any[]) => any>();
  if (options.methodHandlers) {
    for (const [k, v] of Object.entries(options.methodHandlers)) {
      methodHandlers.set(k, v);
    }
  }

  const applyLatency = async () => {
    if (currentLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, currentLatencyMs));
    }
  };

  const checkError = () => {
    if (currentError) {
      throw typeof currentError === 'string' ? new Error(currentError) : currentError;
    }
  };

  return {
    serverURL: new URL('https://mock-soroban-rpc.stellar.org'),

    simulateTransaction: async (tx: any) => {
      await applyLatency();
      checkError();

      if (currentSimulationError) {
        return {
          error: currentSimulationError,
          minResourceFee: currentMinResourceFee,
          cost: { cpuInsns: '0', memBytes: '0' },
        };
      }

      if (options.simulationRestore) {
        return {
          minResourceFee: currentMinResourceFee,
          cost: { cpuInsns: currentCpuInsns, memBytes: currentMemBytes },
          transactionData: new SorobanDataBuilder().build().toXDR('base64'),
          restorePreamble: {
            minResourceFee: '5000',
            transactionData: new SorobanDataBuilder(),
          },
        };
      }

      let retval = currentReturnValueScVal;
      const invocation = extractInvocation(tx);
      if (invocation?.functionName) {
        const handler = methodHandlers.get(invocation.functionName);
        if (handler) {
          const result = handler(invocation.args ?? []);
          retval = toScValHelper(result);
        } else if (
          escrowsMap.size > 0 &&
          (invocation.functionName.includes('escrow') || invocation.functionName.includes('get'))
        ) {
          const firstArg = invocation.args?.[0];
          const match =
            escrowsMap.get(firstArg) ??
            escrowsMap.get(String(firstArg)) ??
            escrowsMap.values().next().value;
          if (match !== undefined) {
            retval = toScValHelper(match);
          }
        }
      }

      return {
        minResourceFee: currentMinResourceFee,
        cost: {
          cpuInsns: currentCpuInsns,
          memBytes: currentMemBytes,
        },
        result: {
          retval,
        },
        transactionData: new SorobanDataBuilder().build().toXDR('base64'),
        latestLedger: currentLatestLedger,
      };
    },

    sendTransaction: async () => {
      await applyLatency();
      checkError();
      return {
        hash: 'mock-soroban-tx-hash-1234567890',
        status: 'PENDING',
      };
    },

    getTransaction: async () => {
      await applyLatency();
      checkError();
      return {
        status: currentTxStatus,
        resultXdr: currentReturnValueScVal.toXDR('base64'),
        resultMetaXdr: 'AAAA',
        latestLedger: currentLatestLedger,
      };
    },

    getEvents: async () => {
      await applyLatency();
      checkError();
      return {
        events: options.events ?? [],
        latestLedger: currentLatestLedger,
      };
    },

    getLatestLedger: async () => {
      await applyLatency();
      checkError();
      return {
        sequence: currentLatestLedger,
        protocolVersion: 20,
      };
    },

    getAccount: async (accountId: string) => {
      await applyLatency();
      checkError();
      return {
        accountId: () => accountId,
        sequenceNumber: () => '1',
        incrementSequenceNumber: () => {},
      };
    },

    getLedgerEntries: async () => {
      await applyLatency();
      checkError();
      return {
        entries: [],
        latestLedger: currentLatestLedger,
      };
    },

    getHealth: async () => {
      await applyLatency();
      checkError();
      return {
        status: 'healthy',
      };
    },

    getNetwork: async () => {
      await applyLatency();
      checkError();
      return {
        passphrase: currentNetworkPassphrase,
        protocolVersion: 20,
      };
    },

    setLatency: (latencyMs: number) => {
      currentLatencyMs = latencyMs;
    },

    setError: (error: Error | string | null) => {
      currentError = error;
    },

    clearError: () => {
      currentError = null;
    },

    setSimulationError: (error: string | null) => {
      currentSimulationError = error;
    },

    clearSimulationError: () => {
      currentSimulationError = null;
    },

    setReturnValue: (val: unknown) => {
      currentReturnValueScVal = toScValHelper(val);
    },

    setReturnValueScVal: (scval: xdr.ScVal) => {
      currentReturnValueScVal = scval;
    },

    setTxStatus: (status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'NOT_FOUND') => {
      currentTxStatus = status;
    },

    setEscrow: (id: string | number, escrow: any) => {
      escrowsMap.set(id, escrow);
    },

    getEscrow: (id: string | number) => {
      return escrowsMap.get(id);
    },

    deleteEscrow: (id: string | number) => {
      escrowsMap.delete(id);
    },

    registerMethod: (name: string, handler: (args: any[]) => any) => {
      methodHandlers.set(name, handler);
    },

    unregisterMethod: (name: string) => {
      methodHandlers.delete(name);
    },
  };
}

/**
 * Mock wallet adapter simulating browser wallet extensions (Freighter, Albedo).
 */
export class MockWalletAdapter {
  publicKey: string;
  connected: boolean = true;

  constructor(publicKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF') {
    this.publicKey = publicKey;
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  async getPublicKey(): Promise<string> {
    return this.publicKey;
  }

  async connect(): Promise<string> {
    this.connected = true;
    return this.publicKey;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async signTransaction(xdrString: string): Promise<string> {
    return xdrString;
  }

  async signAuthEntry(entryXdr: string): Promise<string> {
    return entryXdr;
  }
}

/**
 * Factory builder creating a mock `Escrow` entity with defaults.
 *
 * @param overrides - Optional property overrides
 * @returns Complete Escrow mock object
 */
export function buildMockEscrow(overrides: Partial<Escrow> = {}): Escrow {
  return {
    id: 'mock-escrow-1',
    sender: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    recipient: 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR',
    amount: 10_000_000n,
    status: 'ACTIVE' as EscrowStatus,
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * Factory builder creating a mock `EscrowState` object.
 *
 * @param overrides - Optional property overrides
 * @returns Complete EscrowState mock object
 */
export function buildMockEscrowState(overrides: Partial<EscrowState> = {}): EscrowState {
  return {
    id: 'esc-mock-123',
    params: {
      depositor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      beneficiary: 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR',
      amountXLM: '1.0',
    },
    status: 'active',
    contractEscrowId: 1,
    txHash: 'mock-tx-hash-abcdef',
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * Factory builder creating a mock contract event payload.
 *
 * @param overrides - Optional property overrides
 * @returns Complete mock event payload object
 */
export function buildMockContractEvent(overrides: Record<string, any> = {}) {
  return {
    type: 'escrow.created',
    escrowId: '1',
    payload: {
      depositor: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      beneficiary: 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR',
      amount: '10000000',
    },
    blockNumber: 100,
    txHash: 'mock-event-tx-hash',
    timestamp: Date.now(),
    ...overrides,
  };
}
