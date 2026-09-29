# Spike: the contract's real event topics and payloads, and what the SDK should type

Tracking issue: [#286](https://github.com/trustflow-protocol/trustflow-sdk/issues/286)

**Status: complete for the capture and the comparison; the recommendation below is
not yet implemented.** Everything marked **[source]** was read out of the contract
source, or out of byte-exact `ScVal` XDR produced by running that source, and is
re-verified on every test run by `tests/contract-events-fixture.test.ts`. Nothing in
this document is inferred from documentation or from the SDK's own comments: where
the SDK's comments and the contract disagree, the contract wins and the SDK comment
is called out as wrong.

This issue asked for a spike, so it deliberately changes no runtime code. The
decoder rewrite is [#282](https://github.com/trustflow-protocol/trustflow-sdk/issues/282)
and the fixture here is meant to become its test data.

## 1. How the captures were produced [source]

The contract source is `trustflow-protocol/trustflow-contract @ contracts/trustflow/src/lib.rs`.
The events were captured by driving the contract's own `Env` with the SDK version
that `contracts/Cargo.lock` pins (`soroban-sdk = 20.0.0-rc2.2`), calling each
publishing entry point, and serialising the `ScVal`s the host recorded with
`ToXdr`. That yields the same bytes `soroban-rpc` would return for those events, so
the capture is evidence about the contract rather than a hand-written guess.

Committed as:

- `tests/fixtures/contract-events.json` — the captures, in `getEvents` entry shape.
- `tests/fixtures/load-contract-events.ts` — typed accessors over that file.
- `tests/contract-events-fixture.test.ts` — a guard that re-decodes the XDR and
  asserts the documented vocabulary, so this document cannot silently go stale
  relative to the contract.

Two capture details matter for reading the rest of this document:

- **`topic[0]` is the contract id.** The SDK's `Env` reports the contract id
  separately from the published topics, but an RPC `getEvents` response puts it in
  `topic[0]`. The capture prepends it so the fixture is byte-comparable with real
  RPC output. A capture made without it would have made the parser's mistake in
  §3 look correct.
- **Only `topic[]` and `value` are captured output.** `ledger`, `ledgerClosedAt`,
  `id` and `pagingToken` in the fixture are deterministic placeholders so the file
  is reproducible; the contract id is a deterministic, undeployed address.

## 2. What the deployed contract publishes [source]

Thirteen events, in publish order. Every one is a `namespace`/`verb` symbol pair in
`topic[1]`/`topic[2]`, and every payload is a `#[contracttype]` struct encoded as an
`ScVal::Map` with symbol keys.

| Event | Topics after the contract id | Payload struct | Payload fields (as `ScVal`) |
|---|---|---|---|
| `pauser.set` | `sym(pauser)`, `sym(set)` | `PauserSet` | `admin: scvAddress`, `pauser: scvAddress` |
| `pauser.revoke` | `sym(pauser)`, `sym(revoke)` | `PauserRevoked` | `admin: scvAddress` |
| `circuit.pause` | `sym(circuit)`, `sym(pause)` | `ContractPaused` | `caller: scvAddress` |
| `circuit.unpause` | `sym(circuit)`, `sym(unpause)` | `ContractUnpaused` | `admin: scvAddress` |
| `stake.staked` | `sym(stake)`, `sym(staked)` | `Staked` | `juror: scvAddress`, `amount: scvI128`, `new_total: scvI128` |
| `stake.unstaked` | `sym(stake)`, `sym(unstaked)` | `Unstaked` | `juror: scvAddress`, `amount: scvI128`, `remaining: scvI128` |
| `juror.ttlbump` | `sym(juror)`, `sym(ttlbump)` | `JurorStakeTtlBumped` | `juror: scvAddress`, `live_until_ledger: scvU32` |
| `escrow.init` | `sym(escrow)`, `sym(init)` | `EscrowInitialized` | `escrow_id: scvU64`, `depositor: scvAddress`, `beneficiary: scvAddress`, `amount: scvI128` |
| `mstone.release` | `sym(mstone)`, `sym(release)`, `escrow_id: scvU64`, `milestone_index: scvU32` | `MilestoneTrancheReleased` | `gross_amount: scvI128`, `treasury_fee: scvI128`, `beneficiary_payout: scvI128`, `milestone_released: scvI128`, `escrow_released: scvI128`, `beneficiary: scvAddress`, `treasury: scvAddress` |
| `vote.commit` | `sym(vote)`, `sym(commit)` | `VoteCommitted` | `escrow_id: scvU64`, `juror: scvAddress` |
| `vote.reveal` | `sym(vote)`, `sym(reveal)` | `VoteRevealed` | `escrow_id: scvU64`, `juror: scvAddress`, `vote_for_depositor: scvBool` |
| `slash.slashed` | `sym(slash)`, `sym(slashed)` | `JurorSlashed` | `escrow_id: scvU64`, `juror: scvAddress`, `slash_amount: scvI128`, `remaining_stake: scvI128`, `slash_count: scvU32` |
| `escrow.ttlbump` | `sym(escrow)`, `sym(ttlbump)` | `EscrowTtlBumped` | `escrow_id: scvU64`, `live_until_ledger: scvU32` |

Three properties of this table drive everything else:

1. **`mstone.release` is the only filterable event.** It is the sole event that
   carries `escrow_id` as a topic, and the sole one carrying any second topic at
   all. The source documents this deliberately: the indexed fields exist "so
   indexers can filter without decoding every event". Every other event puts
   `escrow_id` in the data map, so a consumer watching one escrow has to decode
   every event and filter in the SDK.
2. **The data map is sorted by key, not laid out in field order.** `escrow.init`
   declares `escrow_id, depositor, beneficiary, amount` in Rust and arrives on the
   wire as `amount, beneficiary, depositor, escrow_id`. A decoder must look fields
   up by symbol key; positional decoding would silently read the wrong field.
3. **A `#[contracttype]` struct is a map, not a tuple.** There is no positional
   access at all, and the key set is the struct's field set — so the payload is
   self-describing and a new field is a forward-compatible addition rather than a
   shift.

`live_until_ledger` on both TTL-bump events is the watermark the bump was *asked*
for, not the entry's actual expiry: the host only rewrites the TTL if the entry was
within `PERSISTENT_LIFETIME_THRESHOLD` ledgers of expiring, so a recently bumped
entry can outlive the value it reported. [source]

### 2.1 An event that is documented but cannot exist [source]

The capture also holds a `disputed` event carrying a bare `scvAddress` in `value`.
It is kept in the fixture, marked `abandoned`, and is **not** part of the
vocabulary: it comes from `contracts/src`, which is not a workspace member and is
therefore never compiled, so it cannot be on chain. It is in the fixture only
because §3 shows the SDK's vocabulary appears to have been copied from that crate.
`tests/contract-events-fixture.test.ts` asserts it stays segregated from the live
set, so it can never be mistaken for a real event.

## 3. What the SDK assumes today [source: this repo]

`src/events.ts` declares the vocabulary as six underscore-separated names and is
described in its own header comment as the "single source of truth" whose
"canonical event-name convention is underscore-separated (`escrow_created`),
matching the Soroban `Symbol` topic the contract emits and what `decodeScVal` reads
off `topic[0]`."

Both halves of that claim are false, and the fixture test asserts it: **not one of
the six SDK event names appears in any captured topic**, and no captured topic
symbol contains an underscore.

```ts
const eventType = decodeScVal(event.topic[0]) as TrustFlowEventType;
```

The name is read from `topic[0]`, which is the contract-id address. `decodeScVal`
is a stand-in for a real decoder that handles only the `0x0e` (`SCV_STRING`) prefix
and otherwise returns the input unchanged, so for a real event it returns the
base64 of the address `ScVal` — a string that is not a `TrustFlowEventType` at all,
hidden behind a cast. No `switch` case matches, so the default branch returns
`{ type: <base64 blob>, data: {} }`: the `type` field is typed as the vocabulary
union while holding something outside it, and the payload is dropped. The
consequences for a real event are the same in every case — the typed
`escrow_created`/`escrow_released`/`dispute_raised` branches are unreachable.

The typed branches are also wrong about shape even if the name were found. They
read `escrowId` from `topic[1]`, `sender`/`recipient` from `topic[2]`/`topic[3]`,
and `amount` from `BigInt(event.value)`. On a real event `topic[1]` is a symbol,
and `value` is a map, so both would be garbage. `EscrowCreatedData` also uses
`sender`/`recipient` where the contract says `depositor`/`beneficiary`, and
`escrowId` is a `string` where the contract uses `u64`.

Coverage is partial in the shape too: only three of the six names have a typed
payload, and the untyped branch's `type` is a *union* of the other three, which is
why #287 needed `ParsedEventForType` to narrow it. None of the three typed shapes
corresponds to anything the contract publishes.

`SorobanSpec.indexEntries()` in `src/contract/spec.ts` indexes functions, structs,
enums and unions, and **silently skips `scSpecEntryEventV0`**. The event vocabulary
therefore cannot be read from a deployed contract's spec even in principle, which
is why it drifted in the first place.

## 4. Name by name [source]

| SDK name | On chain? | Closest real event | What the contract actually emits |
|---|---|---|---|
| `escrow_created` | no | `escrow.init` | Different name, and `depositor`/`beneficiary` not `sender`/`recipient`, and `escrow_id`/`amount` are in the map, not topics. |
| `escrow_released` | no | `mstone.release` | Release is per milestone tranche, not per escrow, and it reports five amounts plus treasury and beneficiary. There is no escrow-level release event. |
| `escrow_cancelled` | no | none | The contract has **no `cancel` method and no cancel event**. |
| `dispute_raised` | no | none | `raise_dispute` exists but publishes nothing. The dispute is only observable by reading state. |
| `dispute_resolved` | no | `slash.slashed` | `resolve_dispute` publishes only `slash.slashed`, and only when a juror is slashed. A dispute resolved with no slash emits nothing. |
| `milestone_completed` | no | `mstone.release` | Same subject, wrong name; the real event is a *tranche release* with a `milestone_index` topic. |

So: **zero** of the six SDK names exist on chain, and **ten** of the thirteen real
events have no SDK name. The six names look like a plausible design for a simpler
escrow contract, not an observation of this one.

Two related gaps from the same reading [source]:

- **No funding or claim events, because there are no funding or claim methods.**
  `create_escrow`/`init_escrow` do the token transfer themselves — reading the token
  from instance storage and calling `transfer` in the same invocation that emits
  `escrow.init` — so there is no separate funding step, and therefore no separate
  funding event to miss. The SDK's `TrustFlowEscrowClient.fund` and `.claim`, and
  the standalone `cancelEscrow` in `src/escrow/cancel.ts`, have no counterpart in
  the contract's public surface at all, so the events the issue asked about are not
  an omission from the event list — they are a mismatch in the method surface that
  should be tracked separately.
- **No milestone method.** The only occurrence of "milestone" in `src/` is the
  `milestone_completed` event name. The SDK exposes no
  `release_milestone_tranche`, and so cannot trigger or observe the one release
  path that exists.

## 5. Recommendation

The answer to the issue's question — *type everything, a subset, or future-proof it?* —
is **all thirteen, and future-proof it by deriving it from the contract rather than
by enumerating it again.** Specifically:

1. **Replace the six names with the thirteen real ones**, keeping the contract's
   `namespace`/`verb` spelling so there is one vocabulary rather than a
   translation layer. This is a breaking change to a public union and needs a
   maintainer decision on the release; §4 lists what is lost if the phantom names
   are simply deleted (`escrow_cancelled` and `dispute_raised` have no replacement).
2. **Read the event vocabulary and payload types out of the contract spec**, by
   adding `scSpecEntryEventV0` to `SorobanSpec.indexEntries()`. A hardcoded union is
   what failed here; the fix is a machine-readable source of truth, and the contract
   already emits its events in the spec. Payloads map onto the `SpecStruct` entries
   the spec already indexes, so `EscrowInitialized` and friends give the field names
   and types for free.
3. **Decode with the real XDR types**, not the `decodeScVal` stand-in, and look map
   fields up by symbol key (§2, property 2).
4. **Keep `mstone.release`'s topics**, and document that it is the only event
   filterable by `escrow_id` on chain — consumers that need per-escrow polling
   should filter server-side on it and treat the rest as a full-stream decode.
5. **Do not widen the union with a catch-all to paper over the gap.** The
   untyped branch in `ParsedTrustFlowEvent` is what let six names survive that the
   contract never had; an unknown event should be surfaced as unknown, not given a
   vocabulary name it has to invent.

Because the decoder is [#282] and the spec indexing is new ground, this spike stops
at the recommendation. The narrowing machinery #287 added is already the right
shape for the thirteen-event union, so #282 only has to fill in the variants.

## 6. Follow-up issue drafts [draft, not filed]

Upstream issue permissions are not available to this branch, so these are drafts for
a maintainer to file.

**Draft A — rewrite `parseEvent` against the real event shape (#282).**
`src/events.ts` reads the event name from `topic[0]` (the contract id), decodes with
a stand-in that only handles `SCV_STRING`, and assumes positional topics and a bare
`value`. Against a real event it returns `type` set to a base64 blob with an empty
payload. Rewrite it to read `namespace`/`verb` from `topic[1]`/`topic[2]`, decode
`ScVal` with `xdr.ScVal.fromXDR`, look payload fields up by symbol key, and use
`mstone.release`'s `topic[3]`/`topic[4]` as indexed `escrowId`/`milestoneIndex`.
Acceptance: `parseEvents` on the `tests/fixtures/contract-events.json` captures
yields the thirteen typed events with the payloads in §2.

**Draft B — index event entries in `SorobanSpec`.**
`SorobanSpec.indexEntries()` handles `scSpecEntryFunctionV0`, `…UdtStructV0`,
`…UdtEnumV0` and `…UdtUnionV0`, and silently drops `scSpecEntryEventV0`, so a
deployed contract's spec cannot tell the SDK what events it emits. Add event
entries (topic types, `docs`) and expose them alongside `getFunction`/`getStruct`
so the event vocabulary and payload types come from the contract instead of a
hardcoded union.

**Draft C — decide the four names that cannot exist.**
`escrow_cancelled`, `dispute_raised`, `dispute_resolved` and `milestone_completed`
have no on-chain event. Either the contract gains the missing events (and
`raise_dispute` starts publishing) or the SDK drops/renames them. This needs a
product decision, and it is the reason the union cannot be replaced silently. It
should be resolved before Draft A, so the union lands in one piece.

**Draft D — add milestone release to the SDK.**
The contract's only release path is `release_milestone_tranche`, and it emits
`mstone.release`; the SDK has no method for it. Add a call plus a way to read
`milestone_index`, or document that milestone escrows are unsupported.

**Draft E — reconcile the escrow method surface.**
`TrustFlowEscrowClient.fund` and `.claim`, and the exported `cancelEscrow`, have no
counterpart among the contract's public methods. Confirm which of these are meant
to be supported and either implement them against real methods or mark them
unsupported, so callers are not offered operations the deployed contract cannot
perform.

## 7. Reproducing the capture

The generator is not committed — it needs a Rust toolchain and a copy of the
contract — but the *fixtures* are, and the guard test is the check that matters:

```sh
npx jest tests/contract-events-fixture.test.ts
```

It re-decodes every XDR in `contract-events.json` and asserts the vocabulary in
§2, so a change to the contract that adds, removes or reshapes an event fails this
test until this document and the fixtures are updated with it.
