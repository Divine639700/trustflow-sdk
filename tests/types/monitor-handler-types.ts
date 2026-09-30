/**
 * Type-level tests for `EscrowMonitor.on` / `off` (#287).
 *
 * This file is compiled by `tsc` and deliberately contains no runtime
 * assertions: every line is a compile-time contract. `ts-jest` does not
 * type-check (the test tsconfig sets `isolatedModules`), so a plain `.test.ts`
 * full of `@ts-expect-error` would assert nothing. Instead
 * `tests/monitor-handler-types.test.ts` runs `tsc` over this file and fails if
 * it produces any diagnostic, so both directions are checked:
 *
 * - a line that must compile produces no error;
 * - a `@ts-expect-error` that stops erroring is itself reported as TS2578
 *   ("Unused '@ts-expect-error' directive"), which fails the runner.
 *
 * Do not import runtime code from a graph that touches `src/contract/*`:
 * the runner filters diagnostics to this file, but a broken module in the
 * graph would still make the run hard to read.
 */
import { EscrowMonitor } from '../../src/escrow/monitor';
import type {
  EscrowCreatedData,
  EventHandler,
  EventHandlerFor,
  MonitorEventName,
  ParsedTrustFlowEvent,
  TrustFlowEventType,
} from '../../src/types/events';

const monitor = new EscrowMonitor();

/* ------------------------------------------------------------------ *
 * Accepted: a literal narrows `event.data` to that event's payload.
 * ------------------------------------------------------------------ */

monitor.on('escrow_created', (e) => {
  const escrowId: string = e.data.escrowId;
  const amount: bigint = e.data.amount;
  void escrowId;
  void amount;
  // The narrowed event is still assignable to the full union.
  const asUnion: ParsedTrustFlowEvent = e;
  void asUnion;
});

monitor.on('escrow_released', (e) => {
  const recipient: string = e.data.recipient;
  void recipient;
});

monitor.on('dispute_raised', (e) => {
  const raisedBy: string = e.data.raisedBy;
  void raisedBy;
});

// The untyped branch of the union: `data` is a plain record, not `never`.
monitor.on('escrow_cancelled', (e) => {
  const data: Record<string, unknown> = e.data;
  void data;
});
monitor.on('dispute_resolved', (e) => {
  void e.data;
});
monitor.on('milestone_completed', (e) => {
  void e.data;
});

// A union of names narrows to the union of their payloads.
const twoNames: 'escrow_created' | 'dispute_raised' =
  Math.random() > 0.5 ? 'escrow_created' : 'dispute_raised';
monitor.on(twoNames, (e) => {
  if (e.type === 'dispute_raised') {
    void e.data.raisedBy;
  } else {
    void e.data.amount;
  }
});

/* ------------------------------------------------------------------ *
 * Accepted: the wildcard, and `off` with the same reference.
 * ------------------------------------------------------------------ */

monitor.on('*', (e) => {
  const type: TrustFlowEventType = e.type;
  void type;
  void e.data;
});

const created: EventHandlerFor<'escrow_created'> = (e) => void e.data.escrowId;
monitor.on('escrow_created', created);
monitor.off('escrow_created', created);

const wildcard: EventHandler = (e) => void e.data;
monitor.on('*', wildcard);
monitor.off('*', wildcard);

/* ------------------------------------------------------------------ *
 * Accepted: an explicit `MonitorEventName` value, and the deprecated
 * `string` escape hatch for a name held in a variable.
 * ------------------------------------------------------------------ */

const name: MonitorEventName = 'escrow_created';
monitor.on(name, (e) => {
  void e.data;
});
monitor.off(name, () => {});

declare const dynamicName: string;
// eslint-disable-next-line @typescript-eslint/no-deprecated
monitor.on(dynamicName, (e) => void e.data);
// eslint-disable-next-line @typescript-eslint/no-deprecated
monitor.off(dynamicName, () => {});

/* ------------------------------------------------------------------ *
 * Rejected: everything below is a `@ts-expect-error`, so this file only
 * compiles while each of them is a genuine type error.
 * ------------------------------------------------------------------ */

// A name the parser never emits.
monitor.on(
  // @ts-expect-error 'not_an_event' is not a TrustFlowEventType
  'not_an_event',
  () => {},
);

// The dot-notation names removed in #108 must not come back.
monitor.on(
  // @ts-expect-error 'escrow.created' is not a TrustFlowEventType
  'escrow.created',
  () => {},
);

// Same for `off`.
monitor.off(
  // @ts-expect-error 'not_an_event' is not a TrustFlowEventType
  'not_an_event',
  () => {},
);

// The literal is rejected, so the deprecated `string` overload cannot be
// used to sneak a typo past the compiler.
const wrongLiteral: 'not_an_event' = 'not_an_event';
// @ts-expect-error a string *literal* is not the deprecated `string` escape hatch
monitor.on(wrongLiteral, () => {});

// A narrowed handler cannot read another event's payload.
monitor.on('escrow_released', (e) => {
  // @ts-expect-error 'raisedBy' belongs to DisputeRaisedData
  void e.data.raisedBy;
});

monitor.on('dispute_raised', (e) => {
  // @ts-expect-error 'recipient' belongs to EscrowReleasedData
  void e.data.recipient;
});

// A wildcard handler stays on the full union, so the narrowing does not leak.
monitor.on('*', (e) => {
  // @ts-expect-error a wildcard handler sees the full union, not EscrowCreatedData
  const created: EscrowCreatedData = e.data;
  void created;
});
