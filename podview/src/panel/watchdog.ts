// The heartbeat watchdog. A small component in the shell (Pulse) re-renders every few seconds and marks each commit;
// a plain timer outside React checks the marks. When the page is visible and React has not committed for a while
// (a wedged root, a render loop, an exception React could not recover from), the watchdog rebuilds the root.
// Timers sleep with the iPad: a check that comes long after the previous one (the page was suspended) only resets
// the clock; hidden pages are never judged.
import {useEffect, useState} from 'react';

export const PULSE_MS = 2000;
export const CHECK_MS = 5000;
export const STALE_MS = 20_000;

export interface WatchdogOptions {
  onStale: () => void;
  now?: () => number;
  visible?: () => boolean;
  staleMs?: number;
  checkMs?: number;
  setInterval?: (handler: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export function createWatchdog({
  onStale,
  now = () => globalThis.performance.now(),
  visible = () => globalThis.document.visibilityState === 'visible',
  staleMs = STALE_MS,
  checkMs = CHECK_MS,
  setInterval: every = (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: stopEvery = handle => {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>);
  },
}: WatchdogOptions) {
  let lastBeat = now();
  let lastCheck = now();
  let handle: unknown = null;

  const check = () => {
    const at = now();
    const suspended = at - lastCheck > checkMs * 3;
    lastCheck = at;
    if (suspended || !visible()) {
      lastBeat = at;
      return;
    }
    if (at - lastBeat > staleMs) {
      lastBeat = at;
      onStale();
    }
  };

  return {
    beat() {
      lastBeat = now();
    },
    start() {
      if (handle !== null) return;
      lastBeat = now();
      lastCheck = lastBeat;
      handle = every(check, checkMs);
    },
    stop() {
      if (handle !== null) stopEvery(handle);
      handle = null;
    },
    check,
  };
}

export type Watchdog = ReturnType<typeof createWatchdog>;

// Renders nothing; re-renders every PULSE_MS and tells the watchdog after every commit.
export function Pulse({onBeat}: {onBeat: () => void}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => {
      setTick(value => value + 1);
    }, PULSE_MS);
    return () => {
      clearInterval(handle);
    };
  }, []);
  useEffect(() => {
    onBeat();
  }, [tick, onBeat]);
  return null;
}
