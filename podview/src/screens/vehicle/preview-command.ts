// The local preview's delayed vehicle command. It has no network or vehicle capability: a timer is never evidence
// of a real wake, accepted command or physical effect. After a wake/answer delay it commits the fixture change as a
// scene event (`vehicle-control`) and confirms only when the scene's fixture shows exactly the wished state. Navigation
// changes presentation only: the authorized fixture command stays bound to its session, exact fixture object and
// revision; any other change ends it as UNKNOWN.
import {validSeatLevels} from './model';
import type {FixtureSeats, PreviewEvent} from './model';

interface FixtureState {
  kind?: unknown;
  mode?: unknown;
  controlsPreview?: unknown;
  revision?: unknown;
  connectionState?: unknown;
  locked?: unknown;
  access?: {rearTrunk?: unknown} | null;
  climate?: {status?: unknown; defrost?: unknown; targetTemperatureC?: unknown; seats?: Partial<FixtureSeats>} | null;
}

export interface PreviewHostState {
  connected?: boolean;
  focus?: string;
  sessionId?: unknown;
  vehicle?: FixtureState | null;
}

export interface PreviewHost {
  live: boolean | undefined;
  state: PreviewHostState | null | undefined;
  dispatch: (event: Record<string, unknown>) => void;
}

export interface PreviewResult {
  status: 'confirmed' | 'failed' | 'unknown';
  reason?: string;
  revision?: number;
  localPreview?: true;
}

interface Intent {
  action: string;
  revision: number;
  confirmed?: true;
  value?: unknown;
  seat?: 'driver' | 'passenger';
  temperatureC?: number;
  seats?: Readonly<FixtureSeats>;
}

interface Operation {
  generation: number;
  vehicle: FixtureState;
  sessionId: string;
  intent: Readonly<Intent>;
  resolve: (result: PreviewResult) => void;
  timers: unknown[];
  signal: AbortSignal | undefined;
  abort: () => void;
  committing?: boolean;
}

export interface PreviewCommandOptions {
  wakeMs?: number;
  totalMs?: number;
  outcome?: string;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

const SETTINGS = ['climate', 'defrost', 'temperature', 'seat-heat', 'climate-settings'];
const isInteger = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

// The one intent an event may carry for this exact fixture revision, or null.
function intentFor(event: PreviewEvent | null | undefined, vehicle: FixtureState): Readonly<Intent> | null {
  if (!event || event.revision !== vehicle.revision) return null;
  if (SETTINGS.includes(event.action) && event.confirmed !== true) return null;
  const intent: Intent = {action: event.action, revision: event.revision as number};
  if (event.confirmed === true) intent.confirmed = true;
  const climate = vehicle.climate ?? {};
  switch (event.action) {
    case 'lock':
      if (typeof event.value !== 'boolean' || event.value === vehicle.locked || (!event.value && !event.confirmed)) {
        return null;
      }
      intent.value = event.value;
      break;
    case 'rear-trunk':
      if (
        (event.value !== 'open' && event.value !== 'closed') ||
        event.value === vehicle.access?.rearTrunk ||
        event.confirmed !== true
      ) {
        return null;
      }
      intent.value = event.value;
      break;
    case 'climate': {
      const enabled = Object.hasOwn(event, 'value') ? event.value : climate.status === 'off';
      if (typeof enabled !== 'boolean' || (enabled === (climate.status === 'heat') && !climate.defrost)) return null;
      intent.value = enabled;
      break;
    }
    case 'defrost':
      if (typeof event.value !== 'boolean' || event.value === climate.defrost) return null;
      intent.value = event.value;
      break;
    case 'temperature':
      if (!isInteger(event.value, 16, 30) || event.value === climate.targetTemperatureC) return null;
      intent.value = event.value;
      break;
    case 'seat-heat':
      if (
        (event.seat !== 'driver' && event.seat !== 'passenger') ||
        !isInteger(event.value, 0, 3) ||
        event.value === climate.seats?.[event.seat] ||
        (event.value > 0 && climate.status === 'off' && event.confirmed !== true)
      ) {
        return null;
      }
      intent.seat = event.seat;
      intent.value = event.value;
      break;
    case 'climate-settings': {
      const seats = event.seats;
      if (
        !isInteger(event.temperatureC, 16, 30) ||
        !validSeatLevels(seats) ||
        (climate.status === 'off' && Object.values(seats).some(level => level > 0) && event.confirmed !== true)
      ) {
        return null;
      }
      intent.temperatureC = event.temperatureC;
      intent.seats = Object.freeze({...seats});
      if (
        intent.temperatureC === climate.targetTemperatureC &&
        (['driver', 'passenger'] as const).every(seat => intent.seats?.[seat] === climate.seats?.[seat])
      ) {
        return null;
      }
      break;
    }
    default:
      return null;
  }
  return Object.freeze(intent);
}

// The fixture after the commit shows exactly the wished state.
function matchesDesired(intent: Intent, before: FixtureState, after: FixtureState): boolean {
  const climate = after.climate;
  const wasOff = before.climate?.status === 'off';
  switch (intent.action) {
    case 'lock':
      return after.locked === intent.value;
    case 'rear-trunk':
      return after.access?.rearTrunk === intent.value;
    case 'climate':
      return climate?.status === (intent.value ? 'heat' : 'off') && climate?.defrost === false;
    case 'defrost':
      return climate?.defrost === intent.value && (!intent.value || climate?.status === 'heat');
    case 'temperature':
      return climate?.targetTemperatureC === intent.value;
    case 'seat-heat':
      return (
        !!intent.seat &&
        climate?.seats?.[intent.seat] === intent.value &&
        (intent.value === 0 || !wasOff || climate?.status === 'heat')
      );
    case 'climate-settings': {
      const seats = intent.seats;
      return (
        !!seats &&
        climate?.targetTemperatureC === intent.temperatureC &&
        (['driver', 'passenger'] as const).every(seat => climate?.seats?.[seat] === seats[seat]) &&
        (!Object.values(seats).some(level => level > 0) || !wasOff || climate?.status === 'heat')
      );
    }
    default:
      return false;
  }
}

export interface PreviewCommand {
  readonly pending: Operation | null;
  send: (
    event: PreviewEvent,
    options?: {signal?: AbortSignal; onProgress?: (progress: {phase: string; localPreview: true}) => void},
  ) => Promise<PreviewResult>;
  // Ends a running command as UNKNOWN when its binding changed (called after each scene change).
  sync: () => void;
  dispose: () => void;
}

export function createPreviewCommand(host: PreviewHost, options: PreviewCommandOptions = {}): PreviewCommand {
  const wakeMs = Number.isFinite(options.wakeMs) ? Math.max(0, options.wakeMs ?? 0) : 2000;
  const totalMs = Number.isFinite(options.totalMs) ? Math.max(wakeMs, options.totalMs ?? 0) : Math.max(wakeMs, 6000);
  const outcome = ['confirmed', 'failed', 'unknown'].includes(options.outcome ?? 'confirmed')
    ? ((options.outcome ?? 'confirmed') as PreviewResult['status'])
    : 'unknown';
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((id: unknown) => {
    globalThis.clearTimeout(id as ReturnType<typeof setTimeout>);
  });
  let generation = 0;
  let pending: Operation | null = null;
  let disposed = false;

  const validBinding = (operation: Operation) => {
    const state = host.state;
    return (
      !disposed &&
      host.live === false &&
      state?.connected === true &&
      state.sessionId === operation.sessionId &&
      state.vehicle === operation.vehicle &&
      state.vehicle.revision === operation.intent.revision
    );
  };

  const finish = (operation: Operation, result: PreviewResult) => {
    if (pending !== operation || operation.generation !== generation) return;
    pending = null;
    for (const timer of operation.timers) clearTimer(timer);
    operation.signal?.removeEventListener('abort', operation.abort);
    operation.resolve({...result, localPreview: true});
  };

  const sync = () => {
    const operation = pending;
    if (operation && !operation.committing && !validBinding(operation)) {
      finish(operation, {status: 'unknown', reason: 'binding-changed'});
    }
  };

  const send: PreviewCommand['send'] = (event, {signal, onProgress} = {}) => {
    if (disposed || pending) return Promise.resolve({status: 'failed', reason: disposed ? 'disposed' : 'busy'});
    const state = host.state;
    const vehicle = state?.vehicle;
    if (
      host.live !== false ||
      state?.connected !== true ||
      state.focus !== 'vehicle' ||
      vehicle?.kind !== 'vehicle' ||
      vehicle.mode !== 'fixture' ||
      vehicle.controlsPreview !== true ||
      !Number.isSafeInteger(vehicle.revision) ||
      (vehicle.revision as number) < 0 ||
      typeof state.sessionId !== 'string' ||
      !state.sessionId ||
      signal?.aborted
    ) {
      return Promise.resolve({status: 'failed', reason: 'not-available'});
    }
    const intent = intentFor(event, vehicle);
    if (!intent) return Promise.resolve({status: 'failed', reason: 'invalid-intent'});
    const sessionId = state.sessionId;
    return new Promise(resolve => {
      const operation: Operation = {
        generation: ++generation,
        vehicle,
        sessionId,
        intent,
        resolve,
        timers: [],
        signal,
        abort: () => {
          finish(operation, {status: 'unknown', reason: 'interrupted'});
        },
      };
      pending = operation;
      signal?.addEventListener('abort', operation.abort, {once: true});
      const progress = (phase: string) => {
        if (pending !== operation || operation.generation !== generation) return;
        try {
          onProgress?.({phase, localPreview: true});
        } catch {
          finish(operation, {status: 'failed', reason: 'presentation-error'});
        }
      };
      operation.timers.push(
        setTimer(() => {
          if (!validBinding(operation)) {
            sync();
            return;
          }
          progress('awaiting');
        }, wakeMs),
      );
      operation.timers.push(
        setTimer(() => {
          if (pending !== operation || operation.generation !== generation) return;
          if (!validBinding(operation)) {
            sync();
            return;
          }
          if (outcome !== 'confirmed') {
            finish(operation, {status: outcome, reason: 'local-preview-outcome'});
            return;
          }
          operation.committing = true;
          try {
            host.dispatch({type: 'vehicle-control', sessionId: operation.sessionId, ...operation.intent});
          } catch {
            finish(operation, {status: 'unknown', reason: 'commit-interrupted'});
            return;
          }
          const current = host.state;
          const after = current?.vehicle;
          const confirmed =
            pending === operation &&
            current?.sessionId === operation.sessionId &&
            current.connected === true &&
            after?.kind === 'vehicle' &&
            after.mode === 'fixture' &&
            after.controlsPreview === true &&
            after.revision === operation.intent.revision + 1 &&
            matchesDesired(operation.intent, operation.vehicle, after);
          finish(
            operation,
            confirmed
              ? {status: 'confirmed', revision: after.revision as number}
              : {status: 'unknown', reason: 'unconfirmed-state'},
          );
        }, totalMs),
      );
      progress(vehicle.connectionState === 'asleep' ? 'waking' : 'awaiting');
    });
  };

  return {
    get pending() {
      return pending;
    },
    send,
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pending) finish(pending, {status: 'unknown', reason: 'disposed'});
      generation++;
    },
  };
}
