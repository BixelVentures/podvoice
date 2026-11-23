// P5 value motion (docs/MOTION.md §3.6) with motion/react.
// - RollingDigits: a figure's changed digits roll (the new one from 30 % below on the quick spring, the old one
//   away as the slot's ::before), right-aligned so 9:59 → 10:00 keeps its columns; the last `still` characters change
//   without motion (seconds). Reduced: the new figure fades in over --pv-dur-tap. Text with words is plain text.
// - useProgress: a ring's progress as a motion value. A countdown tick runs linear over the second; any other change
//   of the same timer (+1 min, Start igen, another app) travels on the smooth spring, and a tick inside it stays on
//   it; a new timer is drawn in place. Reduced keeps the ring continuous: short and linear.
// Only transform and opacity are animated on the digits (compositor); the ring animates the --progress custom
// property its stylesheet reads.
import {animate, useMotionValue} from 'motion/react';
import type {MotionValue} from 'motion/react';
import type {RefObject} from 'react';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {TRANSITION, waapiTiming} from './tokens';
import {useReducedMotion} from './reduced';

const DIGIT_TEXT = /^[\d\s.,:%°CF+\-−]*\d[\d\s.,:%°CF+\-−]*$/;
const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9';

// The sign of a change from its figures: up rolls the new figure in from below.
export function valueDirection(previous: string, next: string): number {
  const read = (text: string) => {
    const figures = text.replace(/\D/g, '');
    return figures ? (/^\s*[-−]/.test(text) ? -1 : 1) * Number(figures) : Number.NaN;
  };
  const a = read(previous);
  const b = read(next);
  return Number.isFinite(a) && Number.isFinite(b) && a !== b ? Math.sign(b - a) : 0;
}

// The characters of `next` that roll: changed digits outside the last `still`, right-aligned.
export function rollingDigits(previous: string, next: string, still = 0): number[] {
  const changed: number[] = [];
  const shift = next.length - previous.length;
  for (let index = 0; index < next.length - still; index++)
    if (isDigit(next[index]) && previous[index - shift] !== next[index]) changed.push(index);
  return changed;
}

interface Roll {
  text: string;
  // Index → the figure that leaves.
  was: Record<number, string>;
  sign: number;
}

export function RollingDigits({text, still = 0}: {text: string; still?: number}) {
  const reduced = useReducedMotion();
  const [roll, setRoll] = useState<Roll>({text, was: {}, sign: 0});
  // A new value: which figures roll is decided when it arrives (state from the previous render, not an effect).
  if (roll.text !== text) {
    const was: Record<number, string> = {};
    if (DIGIT_TEXT.test(roll.text) && DIGIT_TEXT.test(text)) {
      const shift = text.length - roll.text.length;
      for (const index of rollingDigits(roll.text, text, still)) was[index] = roll.text[index - shift] ?? '';
    }
    setRoll({text, was, sign: valueDirection(roll.text, text) || 1});
  }
  const slots = useRef<(HTMLSpanElement | null)[]>([]);
  useLayoutEffect(() => {
    const animations = Object.entries(roll.was).flatMap(([key, was]) => {
      const slot = slots.current[Number(key)];
      const glyph = slot?.firstElementChild;
      if (!slot || !glyph || !slot.getClientRects().length) return [];
      if (reduced) return [animate(glyph, {opacity: [0, 1]}, TRANSITION.tap)];
      const y = `${String(roll.sign * 30)}%`;
      const entering = animate(glyph, {opacity: [0, 1], transform: [`translateY(${y})`, 'none']}, TRANSITION.quick);
      if (!was) return [entering];
      // The old figure is the slot's ::before (data-pv-was): a pseudo-element, animated with the same timing.
      const out = `translateY(${String(-roll.sign * 30)}%)`;
      const leaving = slot.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: out}],
        {...waapiTiming(TRANSITION.quick), pseudoElement: '::before'});
      // A newer value cancels it: that is not an error.
      leaving.finished.catch(() => undefined);
      return [entering, {stop: () => {
        leaving.cancel();
      }}];
    });
    return () => {
      for (const animation of animations) animation.stop();
    };
  }, [roll, reduced]);
  if (!DIGIT_TEXT.test(text)) return <>{text}</>;
  const chars = Array.from(text);
  return (
    <>
      {chars.map((char, index) => (
        // Keyed from the right, so a longer value keeps its columns.
        <span
          key={chars.length - index}
          data-pv-digit=""
          data-pv-was={roll.was[index] || undefined}
          ref={node => {
            slots.current[index] = node;
          }}
        >
          <span>{char}</span>
        </span>
      ))}
    </>
  );
}

export type ProgressSource = 'none' | 'tick' | 'user';

interface Seen {
  id: string;
  remaining: number;
  duration: number | null | undefined;
  status: string;
  at: number;
}

// The ring's progress (0–100) for one timer: the motion value to bind as `--progress`, and the ref of the element
// that carries it and `data-pv-progress` (the source of the last change, which journeys read).
export function useProgress<E extends HTMLElement>(
  progress: number,
  timer: {id: string; remaining: number; duration?: number | null | undefined; status: string},
): readonly [MotionValue<number>, RefObject<E | null>] {
  const reduced = useReducedMotion();
  const value = useMotionValue(progress);
  const node = useRef<E>(null);
  const seen = useRef<Seen | null>(null);
  const userUntil = useRef(0);
  const {id, remaining, duration, status} = timer;
  useEffect(() => {
    const now = globalThis.performance.now();
    const last = seen.current;
    const same = last?.id === id && last.remaining === remaining && last.duration === duration && last.status === status;
    if (same && value.get() === progress) return;
    let source: ProgressSource = 'none';
    if (last?.id === id) {
      const step = last.remaining - remaining;
      const elapsed = (now - last.at) / 1000;
      const tick = status === 'running' && last.status === 'running' && last.duration === duration && step > 0 &&
        step <= elapsed + 1.5;
      // A tick inside a user change's spring stays on the spring, so the ring does not switch curves mid-travel.
      source = tick && now >= userUntil.current ? 'tick' : 'user';
    }
    seen.current = {id, remaining, duration, status, at: now};
    if (node.current && node.current.dataset.pvProgress !== source) node.current.dataset.pvProgress = source;
    if (source === 'none') {
      value.jump(progress);
      return;
    }
    const transition = reduced
      ? source === 'tick' ? TRANSITION.tick() : TRANSITION.reduced
      : source === 'tick' ? TRANSITION.tick() : TRANSITION.smooth;
    // Only a change that starts a travel opens the window (a tick inside it does not extend it).
    if (source === 'user' && now >= userUntil.current)
      userUntil.current = now + (TRANSITION.smooth.duration ?? 0) * 1000;
    const animation = animate(value, progress, transition);
    return () => {
      animation.stop();
    };
  }, [id, remaining, duration, status, progress, reduced, value]);
  return [value, node] as const;
}
