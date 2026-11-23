// What the timer surfaces show, as pure functions of the timer, the access and the alarm's record (ported from
// TimerView's cardContent / timerActions / restartState / pageModel / renderRecent). Lærred »A-Timer«,
// »Timer-pause«, »Timer-faerdig«.
import type {
  CardActions,
  CardContent,
  CardRestart,
  CardSlot,
  RecentChoice,
  Timer,
  TimerAccess,
  TimerPageModel,
} from './model';
import {
  timerAdjustmentBounds,
  timerDurationLabel,
  timerFinishLabel,
  timerProgress,
  timerStateLabel,
  timerTime,
} from './timer-model';

export interface TimerPresentation {
  current: Timer | null;
  visible: Timer[];
  all: Timer[];
  canStart: boolean;
}

// The finished-timer alarm's record of a completion (timer-notice.js).
export interface TimerCompletion {
  at: number;
  started?: number;
  played: boolean;
  exhausted: boolean;
}

const priority = (t: Timer) => (t.status === 'done' ? 0 : t.status === 'running' ? 1 : t.status === 'paused' ? 2 : 3);
const finite = (value: unknown): value is number => Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isInteger(value);
const end = (t: Timer) => (finite(t.deadline) ? t.deadline : t.remaining);

// The one timer the screen shows: an unfinished alarm first, then the running timer ending first.
export function timerPresentation(timers: Timer[]): TimerPresentation {
  const all = timers.filter(t => t.status !== 'cancelled');
  const selected = [...all].sort((a, b) => priority(a) - priority(b) || end(a) - end(b))[0] ?? null;
  // Normalize completed timer data to zero even if a snapshot includes an old secondsLeft value. The renderer
  // replaces the countdown with completion text. Keep the source records intact for owner actions.
  const current = selected?.status === 'done' ? {...selected, remaining: 0} : selected;
  return {current, visible: current ? [current] : [], all: timers, canStart: all.length === 0};
}

export const clockTime = (at: number) =>
  new Date(at).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'}).replace(':', '.');

// Whether Cancel is allowed now (TimerView.canCancel).
export function cancelAllowed(access: TimerAccess): boolean {
  const independent = access.allowIndependentCancel;
  return (
    access.connected === true &&
    access.canCancel === true &&
    (!access.pending || independent) &&
    (!access.awaitingObservation || independent)
  );
}

export function cardContent(
  t: Timer,
  slot: CardSlot,
  {live, completion}: {live: boolean; completion: TimerCompletion | undefined},
): CardContent {
  const progress = timerProgress(t);
  const detail = slot === 'detail';
  const time = t.status === 'done' ? (detail ? '0:00' : 'Tiden er gået') : timerTime(t.remaining);
  // Lærred »A-Timer«: the known total under the time (»af 10:00«), only on the timer page.
  const duration = integer(t.duration) && t.duration > 0 ? t.duration : null;
  const total = detail && duration !== null ? `af ${timerTime(duration)}` : '';
  // The detail title is the product's state label (»Tæller ned«, »På pause«).
  const stateLabel = detail ? timerStateLabel(t) : '';
  const completedNote =
    t.status === 'done' && completion?.exhausted
      ? `${completion.played ? 'Timeren ringede' : 'Timeren blev færdig'} kl. ${clockTime(completion.at)}`
      : '';
  const clock = finite(t.deadline) ? clockTime(t.deadline) : '';
  const running = t.status === 'running' && !t.stale && clock;
  // Ringing: the native alarm (timerFinishLabel), or in the local preview the bell inside its own five minutes.
  const localRinging = !live && !t.ownerBootId && t.status === 'done' && !!completion && !completion.exhausted;
  const ringing = t.status === 'done' && (timerFinishLabel(t) === 'Stop alarm' || localRinging);
  // Lærred »Timer-faerdig«: »Timeren ringede 14.30« from the real finish time (the bell's record, else the deadline).
  const rangAt = finite(completion?.at) ? completion.at : t.deadline;
  const rang = ringing && finite(rangAt) ? `Timeren ringede ${clockTime(rangAt)}` : '';
  const kicker = !detail
    ? t.status === 'done'
      ? ''
      : 'Timer'
    : t.stale
      ? 'Timer'
      : t.status === 'paused'
        ? 'Timer på pause'
        : t.status === 'done' && completedNote
          ? completedNote
          : t.status === 'done' && rang
            ? rang
            : duration !== null
              ? `Timer · ${timerDurationLabel(duration)}`
              : 'Timer';
  const detailStatus = running
    ? `Færdig kl. ${clock}`
    : t.status === 'paused'
      ? 'Ringen står stille, til du fortsætter.'
      : t.status === 'done'
        ? ringing
          ? 'Alarmen ringer, til du stopper den.'
          : ''
        : timerStateLabel(t);
  const rawStatus =
    detail && !t.stale
      ? detailStatus
      : completedNote || t.displayState || (t.stale || !running ? timerStateLabel(t) : `Slutter ${clock}`);
  const state = rawStatus === time ? '' : rawStatus;
  const openLabel = ['Timer', t.status === 'done' ? 'Tiden er gået' : time, state, detail ? '' : 'Åbn timerdetaljer']
    .filter(Boolean)
    .join(' · ');
  const finishLabel = ringing ? 'Stop alarm' : timerFinishLabel(t);
  return {
    timerId: t.id,
    status: t.status,
    stale: String(t.stale === true),
    progressKnown: String(progress !== null),
    progress: String(progress ?? 0),
    total,
    time,
    long: String(t.remaining >= 3600),
    stateLabel,
    kicker,
    state,
    repeat: String(!!stateLabel && state === stateLabel),
    openLabel,
    finishLabel,
    finishAria: `${finishLabel} timer`,
    ringing,
  };
}

// Lærred »Timer-faerdig«: »Start igen · 10 min« beside »Stop alarm«, only with a known duration.
export function cardRestart(t: Timer, access: TimerAccess, live: boolean): CardRestart {
  const duration = t.duration;
  const known = t.status === 'done' && !t.stale && integer(duration) && duration >= 1 && duration <= 86400;
  const allowed = live ? !!t.ownerBootId && access.restartIds.includes(t.id) : !t.ownerBootId;
  const hidden = !known || !allowed;
  const label = known ? `Start igen · ${timerDurationLabel(duration)}` : '';
  const disabled = hidden || access.connected !== true || access.pending || access.awaitingObservation;
  return {hidden, disabled, label};
}

// The detail card's own controls: Pause/Fortsæt (local preview) and ±1 min (native).
export function cardActions(t: Timer, access: TimerAccess, live: boolean): CardActions {
  const connected = access.connected === true;
  const pending = access.adjustPending?.timerId === t.id ? access.adjustPending : null;
  const bounds = timerAdjustmentBounds(t);
  const local = !live && !t.ownerBootId && ['running', 'paused'].includes(t.status);
  const native = live && !!t.ownerBootId && ((!!bounds && access.canAdjust) || !!pending);
  const blocked = access.pending || access.awaitingObservation || !!access.adjustPending;
  const adjust = (delta: number) => {
    // An adjustment in flight for this timer keeps +1/−1 tappable; the taps queue (T1).
    const disabled =
      !native ||
      !connected ||
      !access.canAdjust ||
      (blocked && !pending) ||
      access.adjustBlockedIds.includes(t.id) ||
      !bounds?.[delta < 0 ? 'minus' : 'plus'];
    return {hidden: !native, disabled, loading: !disabled && pending?.deltaSeconds === delta && access.waiting};
  };
  return {
    hidden: !local && !native,
    toggle: {
      hidden: !local,
      disabled: !local || !connected || blocked || !!t.stale,
      label: t.status === 'paused' ? 'Fortsæt' : 'Pause',
    },
    plus: adjust(60),
    minus: adjust(-60),
  };
}

// Whether ±1 min may be sent for this timer now (TimerView.timerAction's guard).
export function adjustAllowed(t: Timer, access: TimerAccess, live: boolean, delta: number): boolean {
  const bounds = timerAdjustmentBounds(t);
  const elsewhere =
    (access.pending || access.awaitingObservation || !!access.adjustPending) && access.adjustPending?.timerId !== t.id;
  return (
    live && !!t.ownerBootId && access.canAdjust && !elsewhere && !access.adjustBlockedIds.includes(t.id) &&
    !!bounds && [-60, 60].includes(delta) && bounds[delta < 0 ? 'minus' : 'plus']
  );
}

// Lærred »A-Timer« »Tidligere timere«: only the product's own timer history, newest first, five unique durations.
export function recentChoices(history: unknown): RecentChoice[] {
  const rows = (Array.isArray(history) ? (history as unknown[]) : []).flatMap(item => {
    const seconds = (item as {seconds?: unknown} | null)?.seconds;
    return integer(seconds) && seconds >= 1 && seconds <= 86400 ? [seconds] : [];
  });
  const unique = [...new Set(rows)].slice(0, 5);
  return unique.map((seconds, index) => ({
    seconds,
    time: timerTime(seconds),
    label: index === 0 ? 'Seneste' : 'Tidligere',
  }));
}

export function runningLabel(current: Timer | null): string {
  return current?.stale
    ? 'Senest kendte timer'
    : current?.status === 'done'
      ? 'Afsluttet timer'
      : current?.status === 'paused'
        ? 'Timer på pause'
        : 'Aktuel timer';
}

// The new-timer draft and the page around the card.
export function pageModel({
  current,
  seconds,
  access,
  recent,
}: {
  current: Timer | null;
  seconds: number | null;
  access: TimerAccess;
  recent: RecentChoice[];
}): TimerPageModel {
  const connected = access.connected === true;
  const blocked = access.pending || access.awaitingObservation;
  const canDraft = connected && !blocked && !current;
  const canStart = connected && access.canStart === true && !current && !blocked;
  const long = seconds !== null && seconds >= 3600;
  return {
    runningLabel: runningLabel(current),
    runningHidden: !current,
    formHidden: !!current,
    formBusy: access.waiting,
    time: seconds === null ? '—' : timerTime(seconds),
    unit: long ? 'timer : min : sek' : 'min : sek',
    long: String(long),
    draftDisabled: !canDraft,
    minusDisabled: !connected || !canDraft || seconds === 1,
    plusDisabled: !connected || !canDraft || seconds === 86400,
    startDisabled: !connected || !canStart || seconds === null,
    validationHidden: seconds !== null,
    recent,
    recentWaiting: !!current || !connected,
    recentHidden: !recent.length,
  };
}

export const canStartTimer = (current: Timer | null, access: TimerAccess) =>
  access.connected === true && access.canStart === true && !current && !access.pending && !access.awaitingObservation;
