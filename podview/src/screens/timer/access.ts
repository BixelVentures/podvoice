// What the timer controls may do now, from the observed snapshot and the command lifecycle (ported from the
// shell's renderLive). Buttons are never locked by a command in flight beyond these rules: ±1 min of the timer being
// adjusted stays tappable (taps queue), and Cancel of the observed timer stays possible during an adjustment.
import {timerRequest} from '../../lib/api/timer-actions';
import type {Snapshot} from '../../lib/api/schemas';
import type {CommandState} from './commands';
import type {TimerAccess} from './model';

const FENCED_TEXT = 'En tidligere timerhandling har ukendt udfald. Ny timerstart er derfor blokeret.';
const UNAVAILABLE_TEXT = 'Timerstyring er ikke tilgængelig lige nu.';

export function liveTimerAccess(state: CommandState, snapshot: Snapshot | null, connected: boolean): TimerAccess {
  const observed = connected && snapshot?.timers.status === 'observed';
  const actions = snapshot?.capabilities.timerActions ?? [];
  const canStart = observed && actions.includes('timer.start');
  const canCancel = observed && actions.includes('timer.cancel');
  const canAdjust = observed && actions.includes('timer.adjust');
  const fences = state.fences.filter(
    operation =>
      operation.bootId === snapshot?.bootId &&
      operation.roomId === snapshot.roomId &&
      (snapshot.timers.status !== 'observed' || operation.epoch === snapshot.timers.epoch),
  );
  const {action, pending, phase} = state;
  const ids = (operations: typeof fences, name: string) =>
    operations.filter(operation => operation.action === name).flatMap(operation => operation.timerId ?? []);
  const awaiting = phase === 'awaiting';
  const adjusting = action?.action === 'timer.adjust' && (pending || awaiting) ? action : null;
  const waiting = pending || awaiting;
  const feedback = waiting
    ? ''
    : state.feedback || (fences.length ? FENCED_TEXT : !canStart && !canCancel ? UNAVAILABLE_TEXT : '');
  const items = snapshot?.timers.status === 'observed' ? snapshot.timers.items : [];
  return {
    connected,
    canStart,
    canCancel,
    restartIds: items
      .filter(t => timerRequest(snapshot, connected, {type: 'timer', action: 'restart', id: t.id}))
      .map(t => t.id),
    canAdjust,
    adjustBlockedIds: ids([...fences, ...(action && !adjusting ? [action] : [])], 'timer.adjust'),
    adjustPending:
      adjusting?.timerId && adjusting.deltaSeconds !== undefined
        ? {timerId: adjusting.timerId, deltaSeconds: adjusting.deltaSeconds}
        : null,
    allowIndependentCancel: !pending || !!adjusting,
    cancelBlockedIds: ids([...fences, ...(action ? [action] : [])], 'timer.cancel'),
    pending,
    waiting,
    awaitingObservation: fences.length > 0 || pending || awaiting || phase === 'unknown',
    feedback,
  };
}

// The local preview: the scene's own connection is the only authority.
export const previewTimerAccess = (connected: boolean): TimerAccess => ({
  connected,
  canStart: connected,
  canCancel: connected,
  restartIds: [],
  canAdjust: false,
  adjustBlockedIds: [],
  adjustPending: null,
  allowIndependentCancel: false,
  cancelBlockedIds: [],
  pending: false,
  waiting: false,
  awaitingObservation: false,
  feedback: '',
});
