// The live countdown between snapshots: a display anchor, never a native deadline, completion or grant (ported
// from TimerView.presentationTimer). While the owner's read is fresh and the timer runs, the shown seconds count
// down from the last source value; on any doubt they stand still at what was shown. Repeated SSE copies of the same
// source value keep their anchor. The screen and the shell's resource rail both read it.
import {createStore} from 'zustand/vanilla';
import type {Snapshot} from '../../lib/api/schemas';
import type {Timer} from './model';

export interface Anchor {
  key: string;
  status: string;
  sourceRemaining: number;
  at: number;
  displayed: number;
  advancing: boolean;
}

export interface DisplayFacts {
  live: boolean;
  snapshot: Snapshot | null;
  // Connection fresh enough to count: connected, not blocked, browser online, read < 6 s old.
  fresh: boolean;
  // The timer page's own access says connected.
  accessConnected: boolean;
}

export function anchorFor(
  anchor: Anchor | null,
  t: Timer,
  {live, snapshot, fresh, accessConnected}: DisplayFacts,
  now: number,
): {anchor: Anchor | null; displayed: number} {
  const s = snapshot;
  if (!live || !t.ownerBootId || s?.bootId !== t.ownerBootId || s.timers.epoch === undefined ||
    s.timers.epoch === null || !Number.isFinite(t.remaining) || t.remaining < 0)
    return {anchor: null, displayed: t.remaining};
  const key = JSON.stringify([s.bootId, s.roomId, s.timers.epoch, t.id]);
  let next: Anchor =
    anchor?.key === key && anchor.status === t.status && anchor.sourceRemaining === t.remaining
      ? anchor
      : {key, status: t.status, sourceRemaining: t.remaining, at: now, displayed: t.remaining, advancing: false};
  const item = s.timers.items.find(row => row.id === t.id);
  const sourceCurrent = s.timers.status === 'observed' && item?.status === t.status && item.secondsLeft === t.remaining;
  const ready = fresh && accessConnected && !t.stale && sourceCurrent && t.status === 'running';
  if (!ready) {
    if (next.advancing) next = {...next, advancing: false};
    return {anchor: next, displayed: next.displayed};
  }
  if (!next.advancing) next = {...next, at: now, displayed: t.remaining, advancing: true};
  const displayed = Math.max(0, Math.ceil(next.sourceRemaining - Math.max(0, now - next.at) / 1000));
  if (displayed !== next.displayed) next = {...next, displayed};
  return {anchor: next, displayed};
}

// The anchored seconds, when there is an anchor.
export const shownOf = (state: DisplayState) => (state.anchor ? state.shown : null);

// The timer as shown: its remaining time from the anchor when it is the anchored one.
export const presentTimer = (timer: Timer, shown: {id: string; remaining: number} | null): Timer =>
  shown?.id === timer.id && shown.remaining !== timer.remaining ? {...timer, remaining: shown.remaining} : timer;

export interface DisplayState {
  anchor: Anchor | null;
  // The shown seconds of the anchored timer, by id.
  shown: {id: string; remaining: number} | null;
}

export function createTimerDisplay(clock: () => number = () => globalThis.performance.now()) {
  const store = createStore<DisplayState>(() => ({anchor: null, shown: null}));
  let tick: ReturnType<typeof setTimeout> | null = null;
  let last: {timer: Timer | null; facts: DisplayFacts} | null = null;
  const stop = () => {
    if (tick !== null) globalThis.clearTimeout(tick);
    tick = null;
  };
  // Re-anchors the current timer against new facts; schedules the next whole second while it counts.
  function sync(timer: Timer | null, facts: DisplayFacts) {
    last = {timer, facts};
    if (!timer) {
      stop();
      if (store.getState().anchor || store.getState().shown) store.setState({anchor: null, shown: null});
      return;
    }
    const now = clock();
    const {anchor, displayed} = anchorFor(store.getState().anchor, timer, facts, now);
    const shown = store.getState().shown;
    const changed = shown?.id !== timer.id || shown.remaining !== displayed;
    if (anchor !== store.getState().anchor || changed)
      store.setState({anchor, shown: changed ? {id: timer.id, remaining: displayed} : shown});
    if (!anchor?.advancing || displayed === 0) {
      stop();
      return;
    }
    if (tick !== null) return;
    const elapsed = Math.max(0, now - anchor.at);
    tick = globalThis.setTimeout(() => {
      tick = null;
      if (last) sync(last.timer, last.facts);
    }, Math.max(1, Math.ceil(1000 - (elapsed % 1000))));
  }
  const present = (timer: Timer): Timer => presentTimer(timer, shownOf(store.getState()));
  function reset() {
    stop();
    last = null;
    store.setState({anchor: null, shown: null});
  }
  return Object.assign(store, {sync, present, reset});
}

export type TimerDisplay = ReturnType<typeof createTimerDisplay>;
