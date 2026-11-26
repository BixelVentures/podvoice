// The sticky action line's trigger (Robot-Sticky; Robot and Tesla): the hero scrolled out of its screen (the screen
// is the scroller, stack.tsx) means the line comes down under the topbar; it goes up again when the hero returns.
// The line hangs in the panel's main area, so it sits right under the topbar whatever the screen's own padding.
import {useEffect, useRef, useState} from 'react';
import {useScreenMotion} from './stack';

export function useStickyHero(onReturn?: () => void) {
  const [hero, setHero] = useState<HTMLElement | null>(null);
  const [past, setPast] = useState(false);
  const back = useRef(onReturn);
  useEffect(() => {
    back.current = onReturn;
  });
  useEffect(() => {
    const root = hero?.closest('[data-screen]');
    if (!hero || !(root instanceof HTMLElement) || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const out = !entry.isIntersecting && entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
      setPast(out);
      if (!out) back.current?.();
    }, {root, threshold: 0});
    observer.observe(hero);
    return () => {
      observer.disconnect();
    };
  }, [hero]);
  return {heroRef: setHero, past, main: hero?.closest('main') ?? null};
}

// The sticky line's wrapper style: it moves and fades with its screen on a push or a back (the line is drawn in the
// main area, outside the screen's layer). Only transform and opacity; nothing at rest (x 0, opacity 1).
export function useStickyFollow() {
  const moving = useScreenMotion();
  return moving ? {x: moving.x, opacity: moving.opacity} : {};
}
