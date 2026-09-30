import {
  createMockHorizonServer,
  createMockSorobanServer,
  MockWalletAdapter,
  buildMockEscrow,
  buildMockEscrowState,
  buildMockContractEvent,
  isValidScVal,
  toBeValidScVal,
} from "../src/testing/index";
import { TrustFlowClient } from "../src/client";
import { xdr } from "@stellar/stellar-sdk";

expect.extend({ toBeValidScVal });

describe("Testing Kit Subpath (#240)", () => {
  const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
  const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  it("supports dependency injection of mock Horizon and Soroban servers", async () => {
    const mockHorizon = createMockHorizonServer({ balanceXLM: "1234.5" });
    const mockSoroban = createMockSorobanServer({ minResourceFee: "20000" });

    const client = new TrustFlowClient({
      contractId,
      horizonServer: mockHorizon as any,
      rpcServer: mockSoroban as any,
    });

    const balance = await client.getBalance(address);
    expect(balance).toBe("1234.5");
    const spy = jest.spyOn(mockHorizon, "loadAccount");
    const balance2 = await client.getBalance(address);
    expect(balance2).toBe("1234.5");
    expect(spy).toHaveBeenCalledWith(address);

    const sorobanServer = client.getSorobanServer();
    expect(sorobanServer).toBe(mockSoroban);
  });

  it("provides MockWalletAdapter with standard signing methods", async () => {
    const adapter = new MockWalletAdapter(address);
    expect(await adapter.isConnected()).toBe(true);
    expect(await adapter.getPublicKey()).toBe(address);
    expect(await adapter.connect()).toBe(address);

    const signed = await adapter.signTransaction("AAAA-tx-xdr");
    expect(signed).toBe("AAAA-tx-xdr");

    const authSigned = await adapter.signAuthEntry("AAAA-auth-xdr");
    expect(authSigned).toBe("AAAA-auth-xdr");

    await adapter.disconnect();
    expect(await adapter.isConnected()).toBe(false);
  });

  it("builds typed fixtures for Escrow, EscrowState, and ContractEvents", () => {
    const escrow = buildMockEscrow({ amount: 500n });
    expect(escrow.amount).toBe(500n);
    expect(escrow.id).toBe("mock-escrow-1");

    const state = buildMockEscrowState({ status: "disputed" });
    expect(state.status).toBe("disputed");
    expect(state.params.depositor).toBe(address);

    const event = buildMockContractEvent({ type: "escrow.released" });
    expect(event.type).toBe("escrow.released");
    expect(event.blockNumber).toBe(100);
  });

  it("validates ScVal structure with isValidScVal and custom matcher", () => {
    const valid = xdr.ScVal.scvU32(42);
    expect(isValidScVal(valid)).toBe(true);
    expect(isValidScVal("not-an-scval")).toBe(false);

    expect(valid).toBeValidScVal();
  });
});
