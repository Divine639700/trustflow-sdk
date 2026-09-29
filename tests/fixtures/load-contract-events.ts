/**
 * Typed access to the captured contract events in `contract-events.json`.
 *
 * The fixtures are the ground truth established by #286: `topic[]` and `value`
 * are the byte-exact `ScVal`s the contract publishes, produced by running the
 * contract's own `Env` with the `soroban-sdk` version it pins. Everything the
 * parser needs is in `raw`; `name` and `status` are the spike's annotations,
 * not part of a `getEvents` response.
 *
 * @see docs/spikes/issue-286-event-ground-truth.md
 */
import fixture from './contract-events.json';
import type { RawContractEvent } from '../../src/events';

export interface CapturedContractEvent {
  /** The contract's own event name, as a `namespace`/`verb` topic pair. */
  name: string;
  /** Present only for events that are documented but not on chain. */
  status?: string;
  /** A `soroban-rpc` `getEvents` entry. */
  raw: RawContractEvent;
}

/** Contract id the capture ran under: a deterministic, undeployed address. */
export const CAPTURED_CONTRACT_ID: string = fixture.contractId;

/** Provenance of the capture, for the test that guards it. */
export const CAPTURE_META = fixture.$meta;

export const capturedEvents: CapturedContractEvent[] = fixture.events as CapturedContractEvent[];

/** Events the deployed contract actually publishes. */
export const liveEvents: CapturedContractEvent[] = capturedEvents.filter((e) => !e.status);

/** Events documented but never on chain (compiled from an abandoned crate). */
export const abandonedEvents: CapturedContractEvent[] = capturedEvents.filter((e) => e.status);

/** The `raw` entries only, for `parseEvents`. */
export const rawCapturedEvents: RawContractEvent[] = capturedEvents.map((e) => e.raw);
