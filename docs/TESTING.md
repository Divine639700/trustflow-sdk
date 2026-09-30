# Testing Guide for TrustFlow SDK

The `@trustflow/sdk/testing` subpath provides consumer-facing test doubles, fakes, and fixture builders for deterministic offline testing of applications integrating with the TrustFlow Protocol.

## Installation / Import

Import test utilities directly from the dedicated `@trustflow/sdk/testing` entry point:

```typescript
import {
  createMockHorizonServer,
  createMockSorobanServer,
  MockWalletAdapter,
  buildMockEscrow,
  buildMockEscrowState,
  buildMockContractEvent,
  isValidScVal,
  toBeValidScVal,
} from "@trustflow/sdk/testing";
```

## Dependency Injection Seams

`TrustFlowClient` supports dependency injection of mock servers via `ClientConfig`:

```typescript
import { TrustFlowClient } from "@trustflow/sdk";
import { createMockHorizonServer, createMockSorobanServer } from "@trustflow/sdk/testing";

const mockHorizon = createMockHorizonServer({ balanceXLM: "150.0" });
const mockSoroban = createMockSorobanServer({ minResourceFee: "10000" });

const client = new TrustFlowClient({
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  horizonServer: mockHorizon as any,
  rpcServer: mockSoroban as any,
});

const balance = await client.getBalance("G...");
console.log("Mock Balance:", balance); // "150.0"
```

## Mock Wallet Adapter

Simulate user wallet connections and transaction signatures in headless unit/integration tests without browser extensions:

```typescript
import { MockWalletAdapter } from "@trustflow/sdk/testing";

const wallet = new MockWalletAdapter("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
const address = await wallet.connect();
const signedXdr = await wallet.signTransaction("AAAA-xdr...");
```

## Fixture Builders

Build test escrow records and contract events with safe defaults and partial overrides:

```typescript
import { buildMockEscrow, buildMockEscrowState } from "@trustflow/sdk/testing";

const escrow = buildMockEscrow({ amount: 50_000_000n });
const gigState = buildMockEscrowState({ status: "disputed" });
```

## Jest ScVal Matcher

Assert that encoded arguments conform to Stellar XDR `ScVal` structures:

```typescript
import { toBeValidScVal } from "@trustflow/sdk/testing";

expect.extend({ toBeValidScVal });

test("encodes contract args correctly", () => {
  const arg = nativeToScVal(100n, { type: "i128" });
  expect(arg).toBeValidScVal();
});
```
