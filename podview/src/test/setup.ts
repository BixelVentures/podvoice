import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';
import {queryClient} from '../lib/query/client';

afterEach(() => {
  cleanup();
  // Every test starts from an empty cache.
  queryClient.clear();
});

// React's act() is how tests flush renders the cache causes.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom rejects every cancelled animation's `finished` promise even when nobody awaits it (a browser only rejects
// a promise someone asked for). motion/react cancels superseded animations, so mark them handled here.
// Node-environment tests (// @vitest-environment node) have no DOM to patch.
if (typeof Element !== 'undefined') {
  const {animate} = Element.prototype as {animate: (this: Element, ...args: Parameters<Element['animate']>) => Animation};
  Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
    const animation = animate.apply(this, args);
    animation.finished.catch(() => undefined);
    return animation;
  };
}

// happy-dom has no CSSTransition; React Aria's overlays ask whether a running animation is one.
if (typeof window !== 'undefined' && !('CSSTransition' in globalThis)) {
  (globalThis as {CSSTransition?: unknown}).CSSTransition = class CSSTransition extends Event {};
}
