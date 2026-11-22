// Timer actions against POST …/api/actions: which request a tap makes, the exact body, and how the answer is read.
// Exactly one send per explicit tap. A transport failure or an unreadable answer is UNKNOWN, never permission to
// resend; the server's explicit refusal is REJECTED (nothing happened).
import {timerReceiptSchema, timerRefusalSchema} from './schemas';
import type {Snapshot, TimerActionName, TimerReceiptBody} from './schemas';

export interface TimerRequest {
  action: TimerActionName;
  args: Record<string, string | number>;
}

export type TimerEvent =
  | {type: 'timer-start'; seconds: number; name: string}
  | {type: 'timer'; action: 'adjust'; id: string; deltaSeconds: number}
  | {type: 'timer'; action: 'restart' | 'cancel'; id: string}
  // Local preview operations (pause, resume, hide, add): never a request to the native owner.
  | {type: 'timer'; action: 'pause' | 'resume' | 'hide' | 'show' | 'add'; id: string};

export type TimerOutcome = 'accepted' | 'unknown' | 'rejected';
export interface TimerReceipt extends Partial<Omit<TimerReceiptBody, 'requestId' | 'ok' | 'outcome'>> {
  ok: boolean;
  requestId: string;
  outcome: TimerOutcome;
  retryAllowed: false;
  error?: string;
}

const REVISION = /^(0|[1-9][0-9]{0,23})$/;
const revision = (value: unknown): value is string => typeof value === 'string' && REVISION.test(value);
const active = (status: unknown) => status === 'running' || status === 'paused';
const duration = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 86400;
// Decimal revisions compare by length, then lexically.
const newer = (a: string, b: string) => a.length > b.length || (a.length === b.length && a > b);

type SnapshotTimers = Pick<Snapshot, 'timers' | 'capabilities'>;

// The request a tap makes on the observed timers, or null when the screen may not make it.
export function timerRequest(
  snapshot: SnapshotTimers | null | undefined,
  connected: boolean | undefined,
  event: TimerEvent,
): TimerRequest | null {
  // Legacy callers pass the transport's raw snapshot: a missing block is no permission.
  const facts = snapshot as Partial<SnapshotTimers> | null | undefined;
  if (!connected || facts?.timers?.status !== 'observed' || !Array.isArray(facts.capabilities?.timerActions)) return null;
  if (!snapshot) return null;
  const actions = snapshot.capabilities.timerActions;
  const items = snapshot.timers.items;
  if (event.type === 'timer-start') {
    const ok = items.length === 0 && actions.includes('timer.start') && duration(event.seconds);
    return ok && typeof event.name === 'string' && event.name.length <= 120
      ? {action: 'timer.start', args: {seconds: event.seconds, name: event.name}}
      : null;
  }
  const row = items.find(t => t.id === event.id);
  if (event.action === 'adjust') {
    if (!actions.includes('timer.adjust') || ![-60, 60].includes(event.deltaSeconds)) return null;
    if (!row || !active(row.status) || !duration(row.durationSeconds)) return null;
    if (!revision(row.sourceRevision)) return null;
    return {
      action: 'timer.adjust',
      args: {timer_id: row.id, delta_seconds: event.deltaSeconds, expected_revision: row.sourceRevision},
    };
  }
  // »Start igen«: the gatekeeper reads duration and label from its own finished row.
  if (event.action === 'restart') {
    const allowed = actions.includes('timer.start') && actions.includes('timer.cancel');
    if (!allowed || !items.every(t => t.status === 'finished')) return null;
    return row && duration(row.durationSeconds) && typeof row.name === 'string' && row.name.length <= 120
      ? {action: 'timer.restart', args: {timer_id: row.id}}
      : null;
  }
  if (event.action !== 'cancel') return null;
  return actions.includes('timer.cancel') && row ? {action: 'timer.cancel', args: {timer_id: event.id}} : null;
}

// The POST body for one request. Throws when the snapshot no longer admits it (nothing is sent).
export function timerActionBody(
  snapshot: Pick<Snapshot, 'bootId' | 'roomId' | 'revision' | 'timers' | 'capabilities'>,
  {action, args}: TimerRequest,
  requestId: string,
) {
  const actions = snapshot.capabilities.timerActions;
  // Restart is the start path after an exact cancel; it needs both capabilities.
  const allowed =
    action === 'timer.restart'
      ? actions.includes('timer.start') && actions.includes('timer.cancel')
      : actions.includes(action);
  if (!allowed) throw new Error('unsupported_action');
  if (action === 'timer.adjust') {
    const row = snapshot.timers.status === 'observed' ? snapshot.timers.items.find(t => t.id === args.timer_id) : null;
    const current =
      !!row &&
      active(row.status) &&
      duration(row.durationSeconds) &&
      revision(row.sourceRevision) &&
      [-60, 60].includes(Number(args.delta_seconds)) &&
      args.expected_revision === row.sourceRevision;
    if (!current) throw new Error('stale_action');
  }
  return {
    bootId: snapshot.bootId,
    roomId: snapshot.roomId,
    taskId: `timers:${String(snapshot.timers.epoch)}`,
    revision: snapshot.revision,
    requestId,
    action,
    args,
  };
}

export const unknownReceipt = (requestId: string): TimerReceipt => ({
  ok: false,
  requestId,
  outcome: 'unknown',
  retryAllowed: false,
});

// Reads the server's answer to one POST.
export function readTimerReceipt(
  {action, args}: TimerRequest,
  requestId: string,
  {ok: okStatus, status}: {ok: boolean; status?: number | undefined},
  body: unknown,
): TimerReceipt {
  if (status === 409) {
    const refusal = timerRefusalSchema.safeParse(body);
    if (refusal.success) return {...refusal.data, requestId, outcome: 'rejected'};
  }
  const parsed = timerReceiptSchema.safeParse(body);
  if (!parsed.success || (!okStatus && status !== 409) || (status === 409 && parsed.data.ok))
    return unknownReceipt(requestId);
  const receipt = parsed.data;
  if (receipt.requestId !== requestId) return unknownReceipt(requestId);
  if (['timer.start', 'timer.restart'].includes(action) && receipt.ok &&
    !(typeof receipt.timerId === 'string' && receipt.timerId.length >= 1 && receipt.timerId.length <= 200))
    return unknownReceipt(requestId);
  if (action === 'timer.adjust' && receipt.ok) {
    const consistent =
      receipt.timerId === args.timer_id &&
      receipt.deltaSeconds === args.delta_seconds &&
      receipt.expectedSourceRevision === args.expected_revision &&
      revision(receipt.sourceRevision) &&
      revision(receipt.expectedSourceRevision) &&
      newer(receipt.sourceRevision, receipt.expectedSourceRevision) &&
      duration(receipt.durationSeconds) &&
      Number.isInteger(receipt.secondsLeft) &&
      (receipt.secondsLeft ?? 0) >= 1 &&
      (receipt.secondsLeft ?? 0) <= receipt.durationSeconds &&
      ['running', 'paused'].includes(receipt.status ?? '');
    if (!consistent) return unknownReceipt(requestId);
  }
  return {...receipt, requestId, outcome: receipt.outcome, retryAllowed: false};
}
