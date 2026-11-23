// Reduced motion as PodView decides it: the one writer (ui/motion.js writeMotionAttribute) marks the document
// `data-pv-motion=reduced` from the system preference or a `data-motion=reduced` ancestor; components read that.
import {useSyncExternalStore} from 'react';

const root = () => globalThis.document.documentElement;

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(root(), {attributes: true, attributeFilter: ['data-pv-motion']});
  return () => {
    observer.disconnect();
  };
}

export const reducedMotion = () => root().dataset.pvMotion === 'reduced';

export const useReducedMotion = () => useSyncExternalStore(subscribe, reducedMotion, () => false);
