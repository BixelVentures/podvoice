// The wall tells HA it is alive: every heartbeat_seconds (panel config) while the page is visible, the websocket
// command podvoice/panel_heartbeat carries the bundle digest the wall runs, its uptime, room and screen. HA's
// binary_sensor »PodView væg online« turns off when the beats stop, and flags a wall that still runs an old bundle.
// Alongside, the frame meter's touch summaries are folded into one »frames« report every few minutes.
import type {HaTransport} from '../lib/ha/transport';
import {transport as appTransport} from '../lib/ha/transport';
import type {Reporter} from './report';

export interface HeartbeatInfo {
  bundle: string;
  room: string | null;
  screen: string;
}

export function installHeartbeat({
  info,
  seconds,
  onAnswer = () => undefined,
  source = appTransport,
  win = globalThis.window,
  startedAt = win.performance.now(),
}: {
  info: () => HeartbeatInfo;
  seconds: () => number;
  // HA's answer to a beat: {expected_bundle, stale} (custom_components/podvoice/panel_ws.py).
  onAnswer?: (answer: unknown) => void;
  source?: HaTransport;
  win?: Window;
  startedAt?: number;
}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const beat = () => {
    const hass = source.current();
    if (!hass || !source.connected() || win.document.visibilityState !== 'visible') return;
    const {bundle, room, screen} = info();
    const message: Record<string, unknown> = {
      type: 'podvoice/panel_heartbeat',
      bundle: bundle.slice(0, 64),
      uptime_s: Math.max(0, Math.floor((win.performance.now() - startedAt) / 1000)),
      screen: screen.slice(0, 32),
    };
    if (room) message.room = room.slice(0, 128);
    try {
      void Promise.resolve(hass.callWS(message)).then(onAnswer, () => undefined);
    } catch {
      // The next beat tries again.
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    const every = Math.min(3600, Math.max(10, seconds() || 60)) * 1000;
    timer = setTimeout(() => {
      beat();
      schedule();
    }, every);
  };
  const shown = () => {
    if (win.document.visibilityState === 'visible') {
      beat();
      schedule();
    }
  };
  win.document.addEventListener('visibilitychange', shown);
  // The first beat once HA's `hass` has arrived.
  const first = setTimeout(beat, 1500);
  schedule();
  return () => {
    clearTimeout(timer);
    clearTimeout(first);
    win.document.removeEventListener('visibilitychange', shown);
  };
}

export interface FrameSession {
  kind?: string;
  frames?: number;
  over34?: number;
  maxFrameMs?: number | null;
  p95FrameMs?: number | null;
}

// One line for HA's log from the frame meter's sessions since the last summary.
export function frameSummary(sessions: FrameSession[]): string | null {
  if (!sessions.length) return null;
  const frames = sessions.reduce((sum, item) => sum + (item.frames ?? 0), 0);
  const dropped = sessions.reduce((sum, item) => sum + (item.over34 ?? 0), 0);
  const worst = Math.max(0, ...sessions.map(item => item.maxFrameMs ?? 0));
  const p95 = Math.max(0, ...sessions.map(item => item.p95FrameMs ?? 0));
  const kinds = [...new Set(sessions.map(item => item.kind ?? 'tap'))].join(',');
  return `${String(sessions.length)} touches (${kinds}): ${String(frames)} frames, ${String(dropped)} over 34 ms, ` +
    `worst ${String(worst)} ms, worst p95 ${String(p95)} ms`;
}

export function installFrameReports(
  reporter: Reporter,
  take: () => FrameSession[],
  everyMs = 5 * 60_000,
): () => void {
  const handle = setInterval(() => {
    const line = frameSummary(take());
    if (line) reporter.report({kind: 'frames', message: line});
  }, everyMs);
  return () => {
    clearInterval(handle);
  };
}

// An old bundle on the wall (HA serves a newer one after an update): the page reloads itself once, but only while
// nobody uses it (Ro, or Hjem untouched), and never twice for the same expected bundle, so a reload that still gets
// the old bundle (a cache) cannot loop. Returns whether it reloaded.
export const STALE_RELOAD_KEY = 'podview.stale-reload';

export function reloadForStaleBundle({
  answer,
  running,
  idle,
  storage,
  reload,
}: {
  answer: unknown;
  running: string;
  idle: () => boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload: () => void;
}): boolean {
  const {expected_bundle: expected, stale} = (answer ?? {}) as {expected_bundle?: unknown; stale?: unknown};
  if (stale !== true || typeof expected !== 'string' || !expected || expected === running) return false;
  if (!idle()) return false; // The next beat asks again.
  try {
    if (!storage || storage.getItem(STALE_RELOAD_KEY) === expected) return false;
    storage.setItem(STALE_RELOAD_KEY, expected);
  } catch {
    return false; // Without storage there is no loop guard: stay on the old bundle.
  }
  reload();
  return true;
}

// No one touched the wall for `seconds()` (panel config idle_home_seconds; 0 = off): back to Hjem in the URL's room.
export function installIdleHome({
  seconds,
  onIdle,
  win = globalThis.window,
}: {
  seconds: () => number;
  onIdle: () => void;
  win?: Window;
}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    const wait = seconds();
    if (!(wait > 0)) return;
    timer = setTimeout(onIdle, wait * 1000);
  };
  const options = {capture: true, passive: true};
  win.addEventListener('pointerdown', arm, options);
  win.addEventListener('keydown', arm, options);
  arm();
  return () => {
    clearTimeout(timer);
    win.removeEventListener('pointerdown', arm, options);
    win.removeEventListener('keydown', arm, options);
  };
}
