# Spec-Driven Contract Bindings

This guide covers the SDK's spec-driven contract client: `SorobanSpec`, `AbstractContractClient`,
`SorobanContractClient`, `createContractBinding` / `TrustFlowClient.createContractBinding`, and
`generateTypeScriptBindings`. The source lives in `src/contract/`.

Written against `@trustflow/sdk` 0.2.1. The behaviour described below is read from the source at that
version; the snippets were written against the current package types but were not compiled or run
against a live network as part of this document, so check them with `tsc --noEmit` in your own project.

Entries marked **gap** in the type-mapping table are known problems with a tracking issue.

## 1. Getting spec entries

A binding is built from the contract's spec, a list of `ScSpecEntry` values describing its functions
and user-defined types. The SDK **does not fetch the spec from the network**; you supply it.

`SorobanSpec` (and every constructor that takes `specEntries`) accepts an array whose items can be:

| Item | Handling |
| --- | --- |
| `xdr.ScSpecEntry` | used as is |
| `string` | parsed as base64 XDR, falling back to hex XDR |
| `Uint8Array` / `Buffer` | parsed as raw XDR |
| object with `toXDR()` | serialised and parsed (an entry from a second copy of `@stellar/stellar-sdk`) |

Anything else, or an item that cannot be decoded, throws a `TrustFlowError` (`INVALID_CONTRACT_CALL`)
naming the item's index rather than being skipped.

Each array item must be exactly **one** spec entry. A compiled contract embeds its spec in the
`contractspecv0` custom section of the WASM file, and that raw section is a concatenation of entries,
so it has to be split into one entry per array item before it is passed in. Stellar tooling can produce
entries for you (for example the `contract.Spec` helper in `@stellar/stellar-sdk`, or the Stellar CLI's
spec/bindings output); check what your installed version offers. Any other item type in the array is
silently skipped.

## 2. Creating a binding and calling it

```typescript
import { TrustFlowClient } from '@trustflow/sdk';

const client = new TrustFlowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
});

// One base64-encoded ScSpecEntry per item.
const specEntries: string[] = JSON.parse(process.env.TRUSTFLOW_SPEC_ENTRIES!);

const binding = client.createContractBinding(specEntries);
```

`createContractBinding(client, specEntries, contractId?)` is the same call as a free function, and
`generateContractBindings` is an alias of it. Pass `contractId` to target a different contract than
`client.contractId`.

### Call style 1: `binding.methods.*`

For each spec function `foo_bar` the binding exposes:

| Property on `binding.methods` | What it does |
| --- | --- |
| `foo_bar(args, caller, signAndSubmit?)` | invoke: simulate, and submit if `signAndSubmit` is given |
| `read_foo_bar(args?)` | read-only simulation, returns the decoded value |
| `simulate_foo_bar(args?)` | simulation, returns a `SimulationResult` |
| `fooBar`, `readFooBar`, `simulateFooBar` | camelCase aliases (only when the camelCase name differs) |

`args` is either a positional array or an object keyed by the spec's parameter names. The argument count
must match the spec, otherwise `TrustFlowError` `INVALID_CONTRACT_CALL` is thrown; so is calling a method
name that is not in the spec. Invoke methods are also attached directly to the binding instance when the
name does not collide with an existing property.

```typescript
const caller = 'G...'; // the account that sends the transaction

// Read-only call, positional or named arguments.
const escrow = await binding.methods.read_get_escrow(['escrow-1']);
const sameEscrow = await binding.methods.read_get_escrow({ escrow_id: 'escrow-1' });

// Invoke. The callback receives the transaction XDR and must return the transaction hash.
const result = await binding.methods.create_escrow(
  { depositor: caller, beneficiary: 'G...', amount: 1_000_0000n, duration: 86_400 },
  caller,
  async (txXdr) => {
    // Sign txXdr with your wallet, submit it, and return the hash.
    return submitSignedTransaction(txXdr);
  },
);
console.log(result.success, result.txHash, result.result);
```

`submitSignedTransaction` stands for your own signing and submission code (for example a wallet adapter
plus a Soroban RPC `sendTransaction`); the SDK does not provide it here. Function and parameter names
above are placeholders; use the names from your contract's spec.

### Call style 2: the generated class

`generateTypeScriptBindings` produces TypeScript source for a class that extends
`AbstractContractClient` with one typed method per function (see section 6). You can also subclass
`AbstractContractClient` yourself and implement its abstract `invoke`, `read` and `simulate`, or extend
`SorobanContractClient` and call `this.invoke('create_escrow', args, caller, signAndSubmit)`.

## 3. Type-mapping table

Encoding is done by `SorobanSpec.valToScVal` (used by `encodeArgs`), decoding by
`decodeReturnValue`. **Decoding is not spec-driven today**: every return value goes through
`scValToNative`, whatever the declared output type, and `decodeReturnValue` ignores the method name.

| `ScSpecType` | Accepted JS input | `ScVal` produced | Decoded output | Status |
| --- | --- | --- | --- | --- |
| `Val` | anything `nativeToScVal` accepts | inferred by `nativeToScVal` | native value | ok |
| `Bool` | a real `boolean` only | `bool` | `boolean` | ok |
| `Void` | ignored | `void` | `undefined` | ok |
| `U32`, `I32` | integer `number`, `bigint` or base-10 integer string, range-checked | `u32` / `i32` | `number` | ok |
| `U64`, `I64` | `bigint`, safe-integer `number` or base-10 integer string, range-checked | `u64` / `i64` | `bigint` | ok |
| `U128` | `bigint`, safe-integer `number` or base-10 integer string, range-checked | `u128` | `bigint` | ok |
| `I128` | `bigint`, safe-integer `number` or base-10 integer string, range-checked | `i128` | `bigint` | ok |
| `U256`, `I256` | `bigint`, safe-integer `number` or base-10 integer string, range-checked | `u256` / `i256` | `bigint` | ok |
| `Timepoint` | as `U64` | `timepoint` | `bigint` | ok |
| `Duration` | as `U64` | `duration` | `bigint` | ok |
| `Bytes`, `BytesN` | even-length hex string, `Uint8Array` or `Buffer`; `BytesN` must have exactly `N` bytes | `bytes` | `Buffer` | ok |
| `String` | a `string` | `string` | `string` | ok |
| `Symbol` | a string of 1-32 characters from `A-Z a-z 0-9 _` | `symbol` | `string` | ok |
| `Address` | address string (`G...` / `C...`); a malformed address throws `INVALID_CONTRACT_CALL` | `address` | `string` | ok |
| `Option<T>` | `null` / `undefined` for none, otherwise a `T` | `void` or the inner value | inner value or `null` | ok |
| `Vec<T>` | array of `T` (other values throw `INVALID_CONTRACT_CALL`) | `vec` | array | ok |
| `Tuple` | array with exactly as many items as the spec, encoded item by item | `vec` | array | ok |
| `Map<K, V>` | `Map`, or a plain object (keys are strings); any other input throws; two entries encoding to the same key throw | `map`, entries key-sorted | `Map` or object | ok |
| `Result<T, E>` | not matched by the encoder, falls through to `nativeToScVal(val)` | inferred | native value | unsupported |
| UDT struct | object with one property per spec field (unknown or missing non-`Option` fields throw) | `map` keyed by field name, entries key-sorted | object | ok |
| UDT enum, UDT union | not matched by name, falls through to `nativeToScVal(val)` | inferred | native value | **gap** (#270) |

Encoding validates instead of coercing. For an object argument map a missing key or an extra key is
rejected (`Option<T>` parameters may be omitted), and every failure raises a `TrustFlowError` with
code `INVALID_CONTRACT_CALL` that names the parameter and, for nested values, the path, for example
`Invalid args.metadata[2]: expected an integer (u32) ...`.

### Map key order

The Soroban runtime requires an `scvMap`'s entries to be in strictly increasing key order and
rejects anything else, so `Map<K, V>` and UDT structs are encoded with their entries sorted by key
regardless of the order they were declared or supplied in. The order used is the host's: the key
type's discriminant first, then the value — numerically for integer keys (so `2` sorts before `10`,
and `-9` before `-1`), bytewise for `Symbol`, `String` and `Bytes` keys (so `Zeta` sorts before
`alpha`, and `a2` before `a10`), and by XDR encoding for `Address` keys, which orders an account
address before a contract address.

`sdk.scvSortedMap` is not used for this: it is best-effort by its own documentation and falls back
to `localeCompare`, which is not a bytewise order.

Two entries that encode to the same key are rejected with `INVALID_CONTRACT_CALL` rather than
producing an invalid map. A `Map` or object cannot hold duplicate keys, so this only triggers for
keys that are distinct natively but encode alike — `1`, `1n` and `'1'` all encode to `scvU32(1)` —
or for a contract spec that declares the same struct field twice.

## 4. `read_*`, `invoke` and `simulate_*`

| | Account used | Submits? | Returns |
| --- | --- | --- | --- |
| `read_*` / `binding.read(name, args?)` | a placeholder account | never | the decoded native value; throws `TrustFlowError` `SIMULATION_ERROR` if the simulation fails |
| `simulate_*` / `binding.simulate(name, args?)` | none | never | `SimulationResult`: `{ success, cost, returnValue?, error? }` |
| `invoke` / `methods.foo_bar` | the `caller` account, loaded from the network | only when `signAndSubmit` is given | `ContractCallResult & { result }` |

`invoke` results, from `invokeContract`:

- Without `signAndSubmit`, the call is only simulated. It returns `success: true` **without `txHash`**,
  with `returnValue` from the simulation. Nothing was sent to the network.
- With `signAndSubmit`, the simulated transaction is assembled and its XDR is passed to the callback
  (`SignAndSubmitFn = (xdr: string) => Promise<string>`). The callback must sign and submit it and
  resolve with the transaction hash, which becomes `txHash`. As implemented, **no confirmation polling
  happens**: `invokeContract` returns as soon as the callback resolves, so `success: true` with a
  `txHash` means the callback returned, not that the transaction was included in a ledger.
- A failed simulation returns `{ success: false }`, and any error thrown while building, simulating or
  inside the callback is caught and also returned as `{ success: false }`; the underlying error is not
  exposed. Argument encoding errors are the exception: they are thrown by `invoke` before the call is
  made.
- `result` is `decodeReturnValue(...)` of `returnValue`, and is `undefined` when there is no return value.

`simulate_*` encodes the arguments, joins their base64 XDR strings and passes them to
`simulateContractCall`; the returned `cost` values are currently placeholders (`'0'`). Verify this
method against a live RPC before relying on it.

## 5. Bindings and contract metadata

`binding.spec` is the `SorobanSpec`, with `functions`, `structs`, `enums` and `unions` maps for
inspecting what the contract declares. `binding.encodeArgs(name, args)` and
`binding.parseXDRPayload(name, args)` return the encoded `ScVal`s (and their base64 XDR) without
calling the network, which is useful for checking how a JS value is encoded.

## 6. Generating TypeScript bindings

`generateTypeScriptBindings(specEntries, { className? })` returns TypeScript source as a string
(default class name `GeneratedContractClient`). It emits interfaces for structs, enums, string-literal
types for unions, and a class extending `AbstractContractClient` with typed `fooBar`, `readFooBar` and
`simulateFooBar` methods.

There is no CLI or `bin` entry (see the spike #78), so run it from your own script:

```typescript
import { writeFileSync } from 'fs';
import { generateTypeScriptBindings } from '@trustflow/sdk';

const specEntries: string[] = JSON.parse(process.env.TRUSTFLOW_SPEC_ENTRIES!);
writeFileSync(
  'src/contracts/EscrowContractClient.ts',
  generateTypeScriptBindings(specEntries, { className: 'EscrowContractClient' }),
);
```

Current limitations:

- The generated source does not compile as emitted (#272), so review it before committing it.
- The generated types follow the mapping in section 3, so they inherit its gaps (for example enums and
  unions, #270, and `Timepoint` / `Duration` handling, #264). Return types are the declared types even
  though decoding is not spec-driven.
- The generated class needs the same spec entries again at construction time
  (`new EscrowContractClient(client, specEntries)`).
