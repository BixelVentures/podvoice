// The sticky action line's trigger (Robot-Sticky; Robot and Tesla): the hero scrolled out of its screen (the screen
// is the scroller, stack.tsx) means the line comes down under the topbar; it goes up again when the hero returns.
// The line hangs in the panel's main area, so it sits right under the topbar whatever the screen's own padding.
import {useEffect, useRef, useState} from 'react';

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
