import { xdr } from '@stellar/stellar-sdk';
import type { TrustFlowEventType } from '../src/events';
import {
  CAPTURE_META,
  CAPTURED_CONTRACT_ID,
  abandonedEvents,
  capturedEvents,
  liveEvents,
  rawCapturedEvents,
} from './fixtures/load-contract-events';

/**
 * Guards the ground truth captured by #286 (`docs/spikes/`).
 *
 * These are assertions about the *contract*, not about the SDK: they decode
 * the captured XDR and check it against the documented contract event
 * vocabulary, so the fixture cannot silently go stale relative to
 * `contracts/trustflow/src/lib.rs`. They deliberately do not assert what
 * `parseEvent` does with any of this — the decoder rewrite is #282, and a test
 * that pinned today's output would fail the moment that lands.
 */

/** stellar-base 15 returns child structs; signed 128-bit = hi<<64 | lo. */
function toBigInt128(i: ReturnType<xdr.ScVal['i128']>): bigint {
  const raw = (BigInt(i.hi().toString()) << 64n) + BigInt(i.lo().toString());
  return raw >= 1n << 127n ? raw - (1n << 128n) : raw;
}

function decode(b64: string): xdr.ScVal {
  return xdr.ScVal.fromXDR(b64, 'base64');
}

function scValType(b64: string): string {
  return decode(b64).switch().name;
}

function symbolOf(b64: string): string {
  return decode(b64).sym().toString('utf8');
}

function mapOf(b64: string): Array<[string, xdr.ScVal]> {
  const entries = decode(b64).map();
  if (!entries) throw new Error(`not a map: ${b64}`);
  return entries.map((entry) => [entry.key().sym().toString('utf8'), entry.val()]);
}

/** The event name as the contract spells it: `namespace` + `verb`. */
function contractEventName(e: (typeof capturedEvents)[number]): string {
  return `${symbolOf(e.raw.topic[1])}.${symbolOf(e.raw.topic[2])}`;
}

describe('captured contract events (#286)', () => {
  it('records where the capture came from', () => {
    expect(CAPTURE_META.source).toContain('soroban-sdk');
    expect(CAPTURE_META.capturedBy).toContain('issue-286');
  });

  it('covers every event the contract publishes, in getEvents shape', () => {
    expect(liveEvents.length).toBe(13);
    expect(liveEvents.map(contractEventName)).toEqual([
      'pauser.set',
      'pauser.revoke',
      'circuit.pause',
      'circuit.unpause',
      'stake.staked',
      'stake.unstaked',
      'juror.ttlbump',
      'escrow.init',
      'mstone.release',
      'vote.commit',
      'vote.reveal',
      'slash.slashed',
      'escrow.ttlbump',
    ]);
  });

  it('has the RPC contract id as topic[0] and two symbol topics after it', () => {
    for (const e of liveEvents) {
      const { topic } = e.raw;
      // soroban-rpc returns the contract id as the first topic; the SDK's Env
      // reports it separately, so the capture prepends it.
      expect(scValType(topic[0])).toBe('scvAddress');
      expect(scValType(topic[1])).toBe('scvSymbol');
      expect(scValType(topic[2])).toBe('scvSymbol');
      expect(e.raw.contractId).toBe(CAPTURED_CONTRACT_ID);
      expect(e.raw.type).toBe('contract');
    }
  });

  it('carries the escrow id in the data map, not in a topic, for all but mstone.release', () => {
    for (const e of liveEvents) {
      const keys = mapOf(e.raw.value).map(([k]) => k);
      const inTopic = e.raw.topic.slice(1).some((t) => scValType(t) === 'scvU64');
      if (e.name === 'mstone.release') {
        // The one event that filters on chain: (escrow_id, milestone_index).
        expect(scValType(e.raw.topic[3])).toBe('scvU64');
        expect(scValType(e.raw.topic[4])).toBe('scvU32');
      } else {
        expect(inTopic).toBe(false);
      }
      expect(keys.length).toBeGreaterThan(0);
    }
  });

  it('encodes every payload as a contracttype map, never as a bare ScVal', () => {
    for (const e of liveEvents) {
      expect(scValType(e.raw.value)).toBe('scvMap');
    }
  });

  it('uses the documented payload field names and widths', () => {
    const payload = (name: string): Array<[string, string]> => {
      const found = liveEvents.find((e) => e.name === name);
      if (!found) throw new Error(`no capture for ${name}`);
      return mapOf(found.raw.value).map(([key, val]) => [key, val.switch().name]);
    };

    expect(payload('escrow.init')).toEqual([
      ['amount', 'scvI128'],
      ['beneficiary', 'scvAddress'],
      ['depositor', 'scvAddress'],
      ['escrow_id', 'scvU64'],
    ]);
    expect(payload('vote.reveal')).toEqual([
      ['escrow_id', 'scvU64'],
      ['juror', 'scvAddress'],
      ['vote_for_depositor', 'scvBool'],
    ]);
    expect(payload('slash.slashed')).toEqual([
      ['escrow_id', 'scvU64'],
      ['juror', 'scvAddress'],
      ['remaining_stake', 'scvI128'],
      ['slash_amount', 'scvI128'],
      ['slash_count', 'scvU32'],
    ]);
    expect(payload('juror.ttlbump')).toEqual([
      ['juror', 'scvAddress'],
      ['live_until_ledger', 'scvU32'],
    ]);
  });

  it('carries the values the contract was driven with', () => {
    const escrowInit = liveEvents.find((e) => e.name === 'escrow.init')!;
    const fields = new Map(mapOf(escrowInit.raw.value));
    expect(fields.get('escrow_id')!.u64().toString()).toBe('42');
    expect(toBigInt128(fields.get('amount')!.i128())).toBe(100_000_000n);

    const mstone = liveEvents.find((e) => e.name === 'mstone.release')!;
    const mstoneFields = new Map(mapOf(mstone.raw.value));
    expect(toBigInt128(mstoneFields.get('treasury_fee')!.i128())).toBe(500_000n);
    expect(toBigInt128(mstoneFields.get('beneficiary_payout')!.i128())).toBe(99_500_000n);
  });

  it('separates the events that are only documented, never deployed', () => {
    // contracts/src is not a workspace member, so it is never compiled and its
    // `disputed` event cannot be on chain. Kept only to document the shape the
    // SDK vocabulary appears to have been copied from.
    expect(abandonedEvents.map((e) => symbolOf(e.raw.topic[1]))).toEqual(['disputed']);
    expect(abandonedEvents[0].raw.value).toEqual(expect.any(String));
    expect(scValType(abandonedEvents[0].raw.value)).toBe('scvAddress');
    expect(rawCapturedEvents).toHaveLength(capturedEvents.length);
  });

  it('shares no vocabulary with the SDK event names', () => {
    // The drift #286 documents: `TrustFlowEventType` is
    // underscore-separated and derived from the abandoned crate, while the
    // contract publishes a namespace/verb symbol pair. No SDK event name
    // appears in any captured topic.
    const sdkNames: string[] = [
      'escrow_created',
      'escrow_released',
      'escrow_cancelled',
      'dispute_raised',
      'dispute_resolved',
      'milestone_completed',
    ];
    // Compile-time only (ts-jest does not type-check, but `npm run
    // typecheck:tests` does): fails to compile if a name is added to
    // `TrustFlowEventType` and not mirrored here.
    type Assert<T extends true> = T;
    type _NamesMirrorTheUnion = Assert<
      TrustFlowEventType extends (typeof sdkNames)[number] ? true : false
    >;
    const topicSymbols = liveEvents.flatMap((e) =>
      e.raw.topic
        .slice(1)
        .filter((t) => scValType(t) === 'scvSymbol')
        .map(symbolOf),
    );
    for (const name of sdkNames) {
      expect(topicSymbols).not.toContain(name);
    }
    expect(topicSymbols.filter((s) => s.includes('_'))).toEqual([]);
  });
});
