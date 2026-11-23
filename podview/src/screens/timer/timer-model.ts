// Timer records and their wording. The scene (scene-model.js) owns the local preview's timers through
// timerTransition; live timers are the native owner's (live-timers.ts). Ported from timer-model.js.
import type {Timer, TimerScene} from './model';

const finite = (value: unknown): value is number => Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isInteger(value);

// Local demo only. Live timing/expiry must come from the HA native timer owner.
export const timersFor = (s: TimerScene): Timer[] =>
  [s.timer, ...(s.extraTimers ?? [])].filter((t): t is Timer => !!t);

// Native finished is not proof of silence. The existing cancel route requests alert stop; local demos and
// already drained/stopped native alerts only finish.
export const timerFinishLabel = (t: Timer | null | undefined): string =>
  t?.status !== 'done'
    ? 'Annuller'
    : typeof t.ownerBootId === 'string' && !t.physicalStopped && !t.physicalDrained
      ? 'Stop alarm'
      : 'Færdig';

export const timerStateLabel = (t: Pick<Timer, 'stale' | 'status'>): string =>
  t.stale ? 'Ikke opdateret' : t.status === 'done' ? 'Tiden er gået' : t.status === 'paused' ? 'På pause' : 'Tæller ned';

// A native countdown is not its original duration. Only show progress when the owner supplied a consistent total;
// unknown totals stay visually neutral.
export function timerProgress(timer: Partial<Timer> | null | undefined): number | null {
  const {duration, remaining} = timer ?? {};
  return finite(duration) && duration > 0 && finite(remaining) && remaining >= 0 && remaining <= duration
    ? (remaining / duration) * 100
    : null;
}

// Source metadata admits an adjustment; it never rewrites the local countdown.
export function timerAdjustmentBounds(timer: Partial<Timer> | null | undefined): {minus: boolean; plus: boolean} | null {
  const {duration, remaining, sourceRevision, status, stale} = timer ?? {};
  if (stale || !['running', 'paused'].includes(status ?? '') || !integer(duration) || duration < 1 || duration > 86400)
    return null;
  if (!finite(remaining) || remaining <= 0 || remaining > duration) return null;
  if (typeof sourceRevision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(sourceRevision)) return null;
  return {minus: remaining > 60, plus: duration + 60 <= 86400};
}

export const visibleTimers = (s: TimerScene): Timer[] => timersFor(s).filter(t => t.status !== 'cancelled' && !t.hidden);

type Scene = TimerScene & {
  connected?: boolean;
  live?: boolean;
  timerSerial?: number;
  timerHistory?: unknown;
  notice?: string;
};

export type TimerSceneEvent =
  | {type: 'timer-start'; seconds?: number; name?: unknown; now: number}
  | {type: 'tick'; now: number}
  | {type: 'timer-notice-dismiss'; id: string}
  | {type: 'timer'; id: string; action: string; now?: number; seconds?: number}
  | {type: string};

function mapTimers<S extends Scene>(s: S, fn: (t: Timer) => Timer): S {
  const timer = s.timer ? fn(s.timer) : null;
  const extraTimers = (s.extraTimers ?? []).map(fn);
  const same = timer === s.timer && extraTimers.every((t, i) => t === s.extraTimers?.[i]);
  return same ? s : {...s, timer, extraTimers};
}

function localTimer(s: Scene, t: Timer, e: {action: string; now?: number; seconds?: number}): Timer {
  if (t.status === 'cancelled') return t;
  // Local controls never grant mutation authority over native owner records.
  if (e.action === 'hide') return {...t, hidden: true};
  if (e.action === 'show') return {...t, hidden: false};
  if (e.action === 'cancel') return {...t, status: 'cancelled', remaining: 0};
  if (!s.connected || s.live || t.ownerBootId || t.stale) return t;
  const now = e.now;
  // »Start igen« (lærred »Timer-faerdig«): the same duration and label as a new countdown.
  if (e.action === 'restart' && t.status === 'done' && integer(t.duration) && t.duration >= 1 && t.duration <= 86400)
    return finite(now) ? {...t, status: 'running', remaining: t.duration, deadline: now + t.duration * 1000,
      noticeDismissed: false} : t;
  if (e.action === 'add' && t.status === 'done' && e.seconds === 60 && finite(now))
    return {...t, status: 'running', remaining: 60, duration: 60, deadline: now + 60000, noticeDismissed: false};
  if (e.action === 'pause' && t.status === 'running' && finite(now) && finite(t.deadline)) {
    const remaining = Math.max(0, Math.ceil((t.deadline - now) / 1000));
    return {...t, status: remaining === 0 ? 'done' : 'paused', remaining};
  }
  if (e.action === 'resume' && t.status === 'paused' && finite(now) && finite(t.remaining))
    return {...t, status: t.remaining === 0 ? 'done' : 'running', deadline: now + t.remaining * 1000};
  return t;
}

export function timerTransition<S extends Scene>(s: S, e: TimerSceneEvent): S {
  if (e.type === 'timer-start' && 'now' in e) {
    const start = e as {seconds?: number; name?: unknown; now: number};
    const seconds = start.seconds ?? 60;
    if (!s.connected || !integer(seconds) || seconds < 1 || seconds > 86400 || !finite(start.now)) return s;
    // The product exposes one unresolved timer. Existing owner records survive, but hiding/dismissing that timer
    // cannot admit another local start.
    if (timersFor(s).some(t => t.status !== 'cancelled')) return s;
    const name = typeof start.name === 'string' ? start.name.trim().slice(0, 120) : '';
    const timerSerial = (s.timerSerial ?? 0) + 1;
    const history = Array.isArray(s.timerHistory) ? (s.timerHistory as {name?: string; seconds?: number}[]) : [];
    return {
      ...s,
      timerSerial,
      timer: {id: `local-timer-${String(timerSerial)}`, name, duration: seconds, status: 'running', remaining: seconds,
        deadline: start.now + seconds * 1000, hidden: false},
      extraTimers: visibleTimers(s),
      timerHistory: [{name, seconds}, ...history.filter(x => x.name !== name || x.seconds !== seconds)].slice(0, 6),
      notice: '',
    };
  }
  if (e.type === 'tick' && 'now' in e) {
    const now = (e as {now: number}).now;
    if (!finite(now)) return s;
    return mapTimers(s, t => {
      if (t.status !== 'running' || !finite(t.deadline)) return t;
      const remaining = Math.max(0, Math.ceil((t.deadline - now) / 1000));
      return remaining === t.remaining ? t : {...t, remaining, status: remaining === 0 ? 'done' : 'running'};
    });
  }
  if (e.type === 'timer-notice-dismiss' && 'id' in e) {
    const id = (e as {id: string}).id;
    return mapTimers(s, t => (t.id === id && t.status === 'done' && !t.noticeDismissed ? {...t, noticeDismissed: true}
      : t));
  }
  if (e.type === 'timer' && 'id' in e) {
    const event = e as {id: string; action: string; now?: number; seconds?: number};
    return mapTimers(s, t => (t.id === event.id ? localTimer(s, t, event) : t));
  }
  return s;
}

export const timerTime = (seconds: number): string => {
  const n = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return h ? `${String(h)}:${two(m)}:${two(s)}` : `${String(m)}:${two(s)}`;
};

// Lærred »A-Timer«: a whole number of minutes reads »10 min«; anything else is the clock form.
export const timerDurationLabel = (seconds: number): string =>
  integer(seconds) && seconds > 0 && seconds < 3600 && seconds % 60 === 0 ? `${String(seconds / 60)} min`
    : timerTime(seconds);

// Touch picker operates on a draft. It never changes an already running timer.
export const adjustTimerDuration = (seconds: number, delta: number): number =>
  Math.min(86400, Math.max(1, seconds + delta));

export function readTimerDuration(hours: unknown, minutes: unknown, seconds: unknown): number | null {
  const fields = [hours, minutes, seconds];
  if (fields.some(x => String(x).trim() === '' || !Number.isInteger(Number(x)))) return null;
  const [h, m, s] = fields.map(Number) as [number, number, number];
  if (h < 0 || h > 24 || m < 0 || m > 59 || s < 0 || s > 59) return null;
  const total = h * 3600 + m * 60 + s;
  return total >= 1 && total <= 86400 ? total : null;
}
