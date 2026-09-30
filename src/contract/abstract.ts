import { xdr } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../client';
import type { ContractCallResult } from '../types/contract';
import type { SimulationResult } from './simulate';
import type { SignAndSubmitFn } from './invoke';
import { SorobanSpec } from './spec';

/**
 * Base abstract class for Soroban type-safe contract clients and generated bindings.
 *
 * Implementations provide concrete or auto-generated methods matching contract
 * Soroban specs/XDR, ensuring all contract calls are compile-time checked and type-safe.
 *
 * @example
 * ```typescript
 * class MyContractClient extends AbstractContractClient {
 *   async createEscrow(params: CreateParams, caller: string) {
 *     return this.invoke('create_escrow', params, caller);
 *   }
 * }
 * ```
 */
export abstract class AbstractContractClient {
  readonly client: TrustFlowClient;
  readonly contractId: string;
  readonly spec: SorobanSpec;

  /**
   * Creates an instance of AbstractContractClient.
   *
   * @param client - TrustFlowClient instance
   * @param specEntries - Array of Soroban spec entries (XDR base64 strings, ScSpecEntry objects, or Buffers)
   * @param contractId - Optional contract ID override; defaults to client.contractId
   */
  constructor(
    client: TrustFlowClient,
    specEntries: (xdr.ScSpecEntry | string | Uint8Array | Buffer)[],
    contractId?: string,
  ) {
    this.client = client;
    this.contractId = contractId ?? client.contractId;
    this.spec = new SorobanSpec(specEntries);
  }

  /**
   * Encodes JS function parameters into Soroban ScVal array matching the spec for `methodName`.
   *
   * @param methodName - Name of the contract function
   * @param args - Positional array or object map of arguments
   * @returns Array of encoded ScVal objects
   */
  encodeArgs(methodName: string, args: Record<string, unknown> | unknown[]): xdr.ScVal[] {
    return this.spec.encodeArgs(methodName, args);
  }

  /**
   * Decodes a returned ScVal object into a native JS value based on the function output spec.
   *
   * @param methodName - Name of the contract function
   * @param scVal - ScVal returned from contract simulation or invocation
   * @returns Native JS representation of the return value
   */
  decodeReturnValue(methodName: string, scVal: xdr.ScVal): unknown {
    return this.spec.decodeReturnValue(methodName, scVal);
  }

  /**
   * Parses and constructs the full XDR payload details for a contract call.
   *
   * @param methodName - Name of the contract method
   * @param args - Positional array or object map of arguments
   * @returns Metadata object containing method name, encoded ScVals, and base64 XDR array
   */
  parseXDRPayload(
    methodName: string,
    args: Record<string, unknown> | unknown[],
  ): {
    method: string;
    scVals: xdr.ScVal[];
    xdrBase64: string[];
  } {
    const scVals = this.encodeArgs(methodName, args);
    const xdrBase64 = scVals.map((val) => val.toXDR('base64'));
    return {
      method: methodName,
      scVals,
      xdrBase64,
    };
  }

  /**
   * Invokes a contract method using typed spec encoding.
   *
   * @param methodName - Function name defined in the contract spec
   * @param args - Arguments as an array or name-value object
   * @param caller - Address of the caller initiating the transaction
   * @param signAndSubmit - Optional callback to sign and submit the transaction XDR
   * @returns Promise resolving to ContractCallResult with decoded result
   */
  abstract invoke<T = unknown>(
    methodName: string,
    args: Record<string, unknown> | unknown[],
    caller: string,
    signAndSubmit?: SignAndSubmitFn,
  ): Promise<ContractCallResult & { result?: T }>;

  /**
   * Reads contract state by simulating a read-only contract function.
   *
   * @param methodName - Function name defined in the contract spec
   * @param args - Arguments as an array or name-value object
   * @returns Promise resolving to decoded return value
   */
  abstract read<T = unknown>(
    methodName: string,
    args?: Record<string, unknown> | unknown[],
  ): Promise<T>;

  /**
   * Simulates a contract method call to estimate gas and execution outcome.
   *
   * @param methodName - Function name defined in the contract spec
   * @param args - Arguments as an array or name-value object
   * @returns Promise resolving to SimulationResult
   */
  abstract simulate(
    methodName: string,
    args?: Record<string, unknown> | unknown[],
  ): Promise<SimulationResult>;
}
