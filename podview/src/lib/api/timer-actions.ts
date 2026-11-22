// Timer actions against POST …/api/actions: which request a tap makes, the exact body, and how the answer is read.
// Exactly one send per explicit tap. A transport failure or an unreadable answer is UNKNOWN, never permission to
// resend; the server's explicit refusal is REJECTED (nothing happened).
// No runtime imports: the connection owner (podvoice-transport.js) uses this module, and a server test runs that
// transport in plain Node (type stripping), without node_modules.
import type {Snapshot, TimerActionName} from './schemas.ts';

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
export interface TimerReceipt {
  ok: boolean;
  requestId: string;
  outcome: TimerOutcome;
  retryAllowed: false;
  error?: string;
  timerId?: string;
  deltaSeconds?: number;
  expectedSourceRevision?: string;
  sourceRevision?: string;
  durationSeconds?: number;
  secondsLeft?: number;
  status?: string;
}

const OUTCOMES: readonly unknown[] = ['accepted', 'unknown', 'rejected'];
const REFUSALS: readonly unknown[] = ['invalid_action', 'control_not_paired', 'invalid_request', 'timer_unavailable',
  'stale_action', 'unsupported_action', 'request_capacity'];
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

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
  {ok, status}: {ok: boolean; status?: number | undefined},
  body: unknown,
): TimerReceipt {
  const r = record(body) ? body : null;
  // The explicit refusal: nothing happened.
  const refusal = status === 409 && r?.ok === false && r.retryAllowed === false &&
    Object.keys(r).every(key => ['ok', 'error', 'retryAllowed'].includes(key)) && REFUSALS.includes(r.error);
  if (refusal) return {ok: false, retryAllowed: false, error: r.error as string, requestId, outcome: 'rejected'};
  const readable =
    !!r && (ok || status === 409) && !(status === 409 && r.ok !== false) && r.requestId === requestId &&
    typeof r.ok === 'boolean' && OUTCOMES.includes(r.outcome) && r.ok === (r.outcome === 'accepted') &&
    r.retryAllowed === false;
  if (!readable) return unknownReceipt(requestId);
  const receipt = r as unknown as TimerReceipt;
  const started = action === 'timer.start' || action === 'timer.restart';
  const timerId = receipt.timerId as unknown;
  if (started && receipt.ok && !(typeof timerId === 'string' && timerId.length >= 1 && timerId.length <= 200))
    return unknownReceipt(requestId);
  if (action === 'timer.adjust' && receipt.ok) {
    const left = receipt.secondsLeft as unknown;
    const consistent =
      receipt.timerId === args.timer_id &&
      receipt.deltaSeconds === args.delta_seconds &&
      receipt.expectedSourceRevision === args.expected_revision &&
      revision(receipt.sourceRevision) &&
      revision(receipt.expectedSourceRevision) &&
      newer(receipt.sourceRevision, receipt.expectedSourceRevision) &&
      duration(receipt.durationSeconds) &&
      typeof left === 'number' && Number.isInteger(left) && left >= 1 && left <= receipt.durationSeconds &&
      active(receipt.status);
    if (!consistent) return unknownReceipt(requestId);
  }
  return receipt;
}
