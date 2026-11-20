// Time as an external store. A model that depends on the clock (freshness, the next forecast hour, an advice
// expiring) reads `now` with useNow(). The clock is read again whenever server data lands in the cache (so new
// data is never judged by an old time) and at the next moment a model says it will change (useRefreshAt). In
// between it stands still, so an unchanged screen never redraws.
import {useEffect, useState, useSyncExternalStore} from 'react';

const MAX_DELAY = 2147483647;
let current = Date.now();
const listeners = new Set<() => void>();

export function touchClock(at = Date.now()) {
  if (at === current) return;
  current = at;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useNow = () => useSyncExternalStore(subscribe, () => current);

// Re-reads the clock at `at` (ms epoch), if there is one.
export function useRefreshAt(at: number | null) {
  useEffect(() => {
    if (at === null || !Number.isFinite(at)) return;
    const handle = globalThis.setTimeout(() => {
      touchClock();
    }, Math.min(MAX_DELAY, Math.max(0, at - Date.now() + 1)));
    return () => {
      globalThis.clearTimeout(handle);
    };
  }, [at]);
}

// Whether the document is shown (a hidden tab must not start paid work such as an advice request).
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => !globalThis.document.hidden);
  useEffect(() => {
    const update = () => {
      setVisible(!globalThis.document.hidden);
    };
    globalThis.document.addEventListener('visibilitychange', update);
    return () => {
      globalThis.document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return visible;
}
