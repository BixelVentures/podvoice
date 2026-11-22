// The live timer commands: wish → sent → confirmed | unknown | rejected. Ported from the shell's
// sendLiveTimer / reconcileLiveTimer / suspendLiveTimer (widget-view.js). Rules (AGENTS.md, T1):
// - One explicit tap is one send. A transport failure or an unreadable answer is UNKNOWN and is never resent.
// - Only the snapshot proves the effect: the exact timer appears (start), is gone (cancel) or carries a newer
//   revision (±1 min). Same-read copies, other boots, rooms or epochs prove nothing.
// - An accepted action waits 12 s for its proof, then shows an honest unknown.
// - +1/−1 during an adjustment of the same timer is queued in order, each sent once against the fresh revision;
//   never after an unknown. A Cancel of the observed timer stays possible while an adjustment is in flight.
// - An old operation's late answer never overwrites a newer one.
import {createStore} from 'zustand/vanilla';
import type {PodVoiceApi} from '../../lib/api/client';
import type {Snapshot, TimerActionName} from '../../lib/api/schemas';
import {timerRequest} from '../../lib/api/timer-actions';
import type {TimerOutcome, TimerReceipt, TimerRequest} from '../../lib/api/timer-actions';

export const UNKNOWN_TEXT = 'Udfald ukendt · handlingen gentages ikke';
const AWAITING_TEXT = 'Afventer opdateret timer';
const REJECTED_TEXT = 'Handlingen blev afvist · hent aktuel status';
const RECEIVED_TOAST = 'Timeranmodningen er modtaget';
const DROPPED_TOAST = 'Timeren blev ikke bekræftet · dine næste justeringer blev ikke sendt.';
const WAIT_MS = 12000;
const REVISION = /^(0|[1-9][0-9]{0,23})$/;

export type Phase = 'sending' | 'awaiting' | 'unknown' | 'rejected' | null;

// Where the user was when Start was pressed: back to Home once the new timer is observed there.
export interface StartToken {
  sessionId: unknown;
  generation: unknown;
  bootId: string | undefined;
  roomId: string | undefined;
  epoch: unknown;
}

export interface Operation {
  snapshot: Snapshot;
  bootId: string;
  roomId: string;
  epoch: unknown;
  action: TimerActionName;
  timerId: string | null;
  deltaSeconds: number | undefined;
  expectedRevision: string | undefined;
  outcome: TimerOutcome | null;
  waitUntil: number | null;
  uiReturnToken: StartToken | null;
  requestId?: string;
  receipt?: TimerReceipt;
  uncertaintyLogged?: boolean;
  journal: (stage: string, fields?: Record<string, unknown>) => void;
}

export interface CommandState {
  action: Operation | null;
  pending: boolean;
  feedback: string;
  phase: Phase;
  // Earlier operations with an open outcome, kept so their timer stays fenced until proven.
  fences: Operation[];
  queued: {operation: Operation; deltas: number[]} | null;
  generation: number;
  // The Start token of the page's last start tap (TimerScreen sets it).
  startNavigation: StartToken | null;
}

export interface CommandDeps {
  api: () => PodVoiceApi;
  snapshot: () => Snapshot | null;
  // The transport holds a fresh read (liveStatus connected and transport connected).
  connected: () => boolean;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  randomUUID?: () => string;
  toast?: (text: string) => void;
  // Back to Home after an observed start (when the page still shows the same scene).
  completeStart?: (token: StartToken, timerId: string | null) => void;
}

const newer = (a: unknown, b: unknown): boolean =>
  typeof a === 'string' && typeof b === 'string' && REVISION.test(a) && REVISION.test(b) &&
  (a.length > b.length || (a.length === b.length && a > b));

const sameScope = (operation: Operation, snapshot: Snapshot | null) =>
  operation.bootId === snapshot?.bootId &&
  operation.roomId === snapshot.roomId &&
  (snapshot.timers.status !== 'observed' || operation.epoch === snapshot.timers.epoch);

export function createTimerCommands(deps: CommandDeps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  });
  const uuid = deps.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const toast = deps.toast ?? (() => undefined);
  let slowTimer: unknown = null;
  const stopSlow = () => {
    if (slowTimer !== null) clearTimer(slowTimer);
    slowTimer = null;
  };

  const store = createStore<CommandState>(() => ({
    action: null,
    pending: false,
    feedback: '',
    phase: null,
    fences: [],
    queued: null,
    generation: 0,
    startNavigation: null,
  }));
  const get = store.getState;
  const set = store.setState;

  const unknownObservation = (operation: Operation) => {
    if (operation.uncertaintyLogged) return;
    operation.uncertaintyLogged = true;
    operation.journal('control_observation', {code: 'unknown', source: 'snapshot', trust: 'state_observation'});
  };
  const dropQueued = (operation: Operation) => {
    if (get().queued?.operation !== operation) return;
    set({queued: null});
    toast(DROPPED_TOAST);
  };

  // The connection is lost or replaced: an operation in flight has an unknown outcome.
  function suspend() {
    stopSlow();
    const operation = get().action;
    set({generation: get().generation + 1});
    if (!operation) return;
    unknownObservation(operation);
    operation.outcome ??= 'unknown';
    set({pending: false, feedback: UNKNOWN_TEXT, phase: 'unknown'});
    dropQueued(operation);
  }

  function reconcile(snapshot: Snapshot | null) {
    const connected = deps.connected();
    // Independent cancellations can leave older UNKNOWN operations parked. The same exact scoped removal proof
    // resolves those too; never infer a Start.
    if (connected && snapshot?.timers.status === 'observed') {
      const fences = get().fences.filter(operation => {
        const row = snapshot.timers.items.find(timer => timer.id === operation.timerId);
        const removed =
          snapshot !== operation.snapshot &&
          snapshot.bootId === operation.bootId &&
          snapshot.roomId === operation.roomId &&
          snapshot.timers.epoch === operation.epoch &&
          ((operation.action === 'timer.cancel' && !row) ||
            (operation.action === 'timer.adjust' &&
              (!row || row.status === 'finished' || newer(row.sourceRevision, operation.expectedRevision))));
        if (removed)
          operation.journal('control_observation', {
            code: operation.action === 'timer.adjust' ? 'superseded' : 'observed',
            source: 'snapshot',
            trust: 'state_observation',
            ...(operation.action === 'timer.cancel' ? {observedValue: false} : {}),
          });
        return !removed;
      });
      if (fences.length !== get().fences.length) set({fences});
    }
    const operation = get().action;
    if (!operation) return;
    // New authoritative owners retire the old scope, without claiming completion.
    const replaced =
      snapshot?.bootId !== operation.bootId ||
      snapshot.roomId !== operation.roomId ||
      (snapshot.timers.status === 'observed' && snapshot.timers.epoch !== operation.epoch);
    if (connected && snapshot !== operation.snapshot && replaced) {
      stopSlow();
      set({action: null, pending: false, feedback: '', phase: null});
      dropQueued(operation);
      return;
    }
    if (get().pending) return;
    if (operation.waitUntil !== null && now() >= operation.waitUntil && get().phase === 'awaiting') {
      unknownObservation(operation);
      set({feedback: UNKNOWN_TEXT, phase: 'unknown'});
      dropQueued(operation);
    }
    if (!connected || !snapshot || snapshot === operation.snapshot || replaced) return;
    if (snapshot.timers.status !== 'observed') return;
    // Removal is the only completion proof for cancellation/finished acknowledgement. Audio drained/stopped alone
    // must still leave the real finished timer visible.
    const row = snapshot.timers.items.find(timer => timer.id === operation.timerId);
    const receipt = operation.receipt;
    const superseded =
      !row || row.status === 'finished' || newer(row.sourceRevision, receipt?.sourceRevision ?? operation.expectedRevision);
    const confirmedAdjust =
      operation.outcome === 'accepted' &&
      !!row &&
      !!receipt &&
      row.sourceRevision === receipt.sourceRevision &&
      row.durationSeconds === receipt.durationSeconds &&
      row.status === receipt.status &&
      typeof row.secondsLeft === 'number' &&
      Number.isInteger(row.secondsLeft) &&
      row.secondsLeft >= 0 &&
      (row.status === 'paused'
        ? row.secondsLeft === receipt.secondsLeft
        : row.secondsLeft <= (receipt.secondsLeft ?? 0));
    const observed =
      operation.action === 'timer.cancel'
        ? !row
        : operation.action === 'timer.adjust'
          ? superseded || confirmedAdjust
          : operation.outcome === 'accepted' && typeof operation.timerId === 'string' && !!operation.timerId && !!row;
    if (!observed) return;
    const started = operation.action === 'timer.start' || operation.action === 'timer.restart';
    const actual = started ? row?.secondsLeft : false;
    const value =
      operation.action !== 'timer.adjust' &&
      (typeof actual === 'boolean' || (typeof actual === 'number' && Number.isFinite(actual) && actual >= 0 &&
        actual <= 86400));
    operation.journal('control_observation', {
      code: operation.action === 'timer.adjust' && superseded ? 'superseded' : 'observed',
      source: 'snapshot',
      trust: 'state_observation',
      ...(value ? {observedValue: actual} : {}),
    });
    const phase = get().phase;
    stopSlow();
    set({action: null, feedback: '', phase: null});
    if (started && operation.outcome === 'accepted' && operation.uiReturnToken)
      deps.completeStart?.(operation.uiReturnToken, operation.timerId);
    // The next queued +1/−1 is sent now against the fresh revision; never after UNKNOWN (T1).
    const queued = get().queued;
    if (queued?.operation !== operation) return;
    const delta = operation.outcome === 'accepted' && phase === 'awaiting' ? queued.deltas.shift() : undefined;
    const next =
      delta !== undefined && operation.timerId
        ? timerRequest(snapshot, connected, {type: 'timer', action: 'adjust', id: operation.timerId, deltaSeconds: delta})
        : null;
    if (next) void send(next);
    const followed = get().action;
    if (next && followed && queued.deltas.length) set({queued: {operation: followed, deltas: queued.deltas}});
    else if (next && followed) set({queued: null});
    else dropQueued(operation);
  }

  async function send(request: TimerRequest) {
    const scope = deps.snapshot();
    const fences = get().fences.filter(operation => sameScope(operation, scope));
    const connected = deps.connected();
    const timerId = typeof request.args.timer_id === 'string' ? request.args.timer_id : undefined;
    const observedRow = scope?.timers.status === 'observed' && scope.timers.items.some(timer => timer.id === timerId);
    const exactCancel =
      request.action === 'timer.cancel' && connected && observedRow &&
      scope.capabilities.timerActions.includes('timer.cancel');
    if (request.action === 'timer.adjust') {
      const fresh = timerId
        ? timerRequest(scope, connected, {type: 'timer', action: 'adjust', id: timerId,
          deltaSeconds: Number(request.args.delta_seconds)})
        : null;
      if (!fresh || fresh.args.expected_revision !== request.args.expected_revision) {
        set({fences});
        return;
      }
    }
    // +1/−1 during an adjustment of the same timer is queued in order and each is sent once (T1).
    const running = get().action;
    if (request.action === 'timer.adjust' && running?.action === 'timer.adjust' && running.timerId === timerId &&
      (get().pending || get().phase === 'awaiting')) {
      const queued = get().queued?.operation === running ? get().queued : {operation: running, deltas: []};
      set({fences, queued: {operation: running, deltas: [...(queued?.deltas ?? []), Number(request.args.delta_seconds)]}});
      return;
    }
    const fenced = fences.some(
      operation =>
        request.action === 'timer.start' ||
        request.action === 'timer.restart' ||
        (operation.action === 'timer.cancel' && operation.timerId === timerId) ||
        (request.action === 'timer.adjust' && operation.timerId === timerId),
    );
    if ((get().pending && !(exactCancel && running?.action === 'timer.adjust')) || fenced) {
      set({fences});
      return;
    }
    if (running) {
      if (!exactCancel || (running.action === 'timer.cancel' && running.timerId === timerId)) {
        set({fences});
        return;
      }
      fences.push(running);
      set({action: null});
    } else if (!exactCancel && (get().phase === 'awaiting' || get().phase === 'unknown')) {
      set({fences});
      return;
    }
    set({fences});
    if (!scope) return;
    const api = deps.api();
    const generation = get().generation;
    const start = request.action === 'timer.start' || request.action === 'timer.restart';
    const args = request.args;
    const requested =
      request.action === 'timer.cancel'
        ? false
        : request.action === 'timer.adjust' && Number.isInteger(args.delta_seconds) && args.delta_seconds !== 0 &&
            Math.abs(Number(args.delta_seconds)) <= 86400
          ? args.delta_seconds
          : Number.isInteger(args.seconds) && Number(args.seconds) >= 1 && Number(args.seconds) <= 86400
            ? args.seconds
            : undefined;
    const admission = JSON.stringify((scope as {admission?: unknown}).admission ?? null);
    const permitted = scope.capabilities.timerActions.includes(request.action);
    const operation: Operation = {
      snapshot: scope,
      bootId: scope.bootId,
      roomId: scope.roomId,
      epoch: scope.timers.epoch,
      action: request.action,
      timerId: request.action === 'timer.restart' ? null : (timerId ?? null),
      deltaSeconds: typeof args.delta_seconds === 'number' ? args.delta_seconds : undefined,
      expectedRevision: typeof args.expected_revision === 'string' ? args.expected_revision : undefined,
      outcome: null,
      waitUntil: null,
      uiReturnToken: start ? get().startNavigation : null,
      // Diagnostics of this one operation, only while its owner, scope, admission and permission still hold.
      journal: (stage, fields = {}) => {
        const latest = deps.snapshot();
        const owner = deps.api() === api && (stage === 'control_action' || api.diagnostics?.generation() === diagnosticGeneration);
        if (!owner || latest?.bootId !== operation.bootId || latest.roomId !== operation.roomId) return;
        if (JSON.stringify((latest as {admission?: unknown}).admission ?? null) !== admission || !permitted) return;
        if (!latest.capabilities.timerActions.includes(operation.action) || api.diagnostics?.blocked()) return;
        try {
          api.diagnostics?.record(stage, {domain: 'timer', action: operation.action, requestId: operation.requestId,
            resourceId: operation.timerId, ...(requested !== undefined ? {requestedValue: requested} : {}), ...fields});
        } catch {
          /* Journal failure cannot alter timer control. */
        }
      },
    };
    const diagnosticGeneration = api.diagnostics?.generation();
    const current = () => get().action === operation && deps.api() === api && generation === get().generation;
    set({action: operation, pending: true, feedback: '', phase: 'sending'});
    stopSlow();
    try {
      operation.requestId = uuid();
      operation.journal('control_intent', {code: 'start'});
      operation.journal('control_action', {code: 'start'});
      const result = await api.timerAction({...request, requestId: operation.requestId});
      operation.journal('control_action', {
        code: result.ok ? 'accepted' : result.outcome === 'unknown' ? 'unknown' : 'rejected',
        current: current() && api.diagnostics?.generation() === diagnosticGeneration,
        ...(typeof result.timerId === 'string' ? {resourceId: result.timerId} : {}),
      });
      if (!current()) return;
      operation.outcome = result.ok ? 'accepted' : result.outcome === 'unknown' ? 'unknown' : 'rejected';
      if (operation.action === 'timer.adjust' && operation.outcome === 'accepted') operation.receipt = result;
      if (start && operation.outcome === 'accepted')
        operation.timerId =
          typeof result.timerId === 'string' && result.timerId.length > 0 && result.timerId.length <= 200
            ? result.timerId
            : null;
      const feedback =
        operation.outcome === 'accepted' ? AWAITING_TEXT : operation.outcome === 'unknown' ? UNKNOWN_TEXT : REJECTED_TEXT;
      set({feedback});
      if (operation.outcome === 'accepted') {
        operation.waitUntil = now() + WAIT_MS;
        toast(RECEIVED_TOAST);
      }
    } catch {
      if (!current()) return;
      operation.journal('control_action', {code: operation.requestId ? 'unknown' : 'failure'});
      operation.outcome = 'unknown';
      set({feedback: UNKNOWN_TEXT});
    } finally {
      if (current()) settle(operation, current);
    }
  }

  function settle(operation: Operation, current: () => boolean) {
    stopSlow();
    const outcome = operation.outcome;
    set({pending: false, phase: outcome === 'accepted' ? 'awaiting' : outcome === 'unknown' ? 'unknown' : 'rejected'});
    if (outcome !== 'accepted') dropQueued(operation);
    if (outcome === 'rejected') set({action: null});
    reconcile(deps.snapshot());
    if (get().action === operation && outcome === 'accepted' && operation.waitUntil !== null) {
      slowTimer = setTimer(() => {
        if (!current()) return;
        slowTimer = null;
        unknownObservation(operation);
        set({feedback: UNKNOWN_TEXT, phase: 'unknown'});
        dropQueued(operation);
      }, Math.max(0, operation.waitUntil - now()));
    }
  }

  const hasSlowTimer = () => slowTimer !== null;
  return Object.assign(store, {send, reconcile, suspend, hasSlowTimer});
}

export type TimerCommands = ReturnType<typeof createTimerCommands>;
