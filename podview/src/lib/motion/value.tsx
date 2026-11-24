// P5 value motion (docs/MOTION.md §1, P5) with motion/react.
// - RollingDigits: a figure's changed digits roll: the new one in from 30 % below on the quick spring while the old
//   one leaves upwards (AnimatePresence, popped out of the flow), right-aligned so 9:59 → 10:00 keeps its columns; the
//   last `still` characters change without motion (seconds). Reduced: the figures cross-fade (motion/react drops the
//   move). Text with words is plain text.
// - useProgress: a ring's progress as a motion value. A countdown tick runs linear over the second; any other change
//   of the same timer (+1 min, Start igen, another app) travels on the smooth spring, and a tick inside it stays on
//   it; a new timer is drawn in place. Reduced keeps the ring continuous: short and linear.
// Only transform and opacity are animated on the digits; the ring's circle takes the value as its strokeDashoffset.
import {AnimatePresence, animate, motion, useMotionValue, useReducedMotion} from 'motion/react';
import type {MotionValue, Variants} from 'motion/react';
import type {RefObject} from 'react';
import {useEffect, useRef, useState} from 'react';
import {SPRING, TRANSITION, springMs} from './tokens';

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
  // Slot (counted from the right) → how many times it rolled: its glyph's key.
  turns: Record<number, number>;
  sign: number;
}

// The glyph enters from the side the value moves to and leaves to the other (custom = the sign of the change).
const GLYPH: Variants = {
  enter: (sign: number) => ({y: `${String(sign * 30)}%`, opacity: 0}),
  shown: {y: '0%', opacity: 1},
  leave: (sign: number) => ({y: `${String(-sign * 30)}%`, opacity: 0}),
};
const GLYPH_MOTION = {...TRANSITION.quick, opacity: TRANSITION.fade};

export function RollingDigits({text, still = 0}: {text: string; still?: number}) {
  const [roll, setRoll] = useState<Roll>({text, turns: {}, sign: 1});
  // A new value: which figures roll is decided when it arrives (state from the previous render, not an effect).
  if (roll.text !== text) {
    const turns = {...roll.turns};
    if (DIGIT_TEXT.test(roll.text) && DIGIT_TEXT.test(text))
      for (const index of rollingDigits(roll.text, text, still)) {
        const slot = text.length - index;
        turns[slot] = (turns[slot] ?? 0) + 1;
      }
    setRoll({text, turns, sign: valueDirection(roll.text, text) || 1});
  }
  if (!DIGIT_TEXT.test(text)) return <>{text}</>;
  const chars = Array.from(text);
  return (
    <>
      {chars.map((char, index) => {
        // Keyed from the right, so a longer value keeps its columns.
        const slot = chars.length - index;
        return (
          <span key={slot} className="relative inline-block" data-pv-digit="">
            <AnimatePresence initial={false} mode="popLayout" custom={roll.sign}>
              <motion.span
                key={roll.turns[slot] ?? 0}
                className="inline-block"
                custom={roll.sign}
                variants={GLYPH}
                initial="enter"
                animate="shown"
                exit="leave"
                transition={GLYPH_MOTION}
              >
                {char}
              </motion.span>
            </AnimatePresence>
          </span>
        );
      })}
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

// The ring's progress (0–100) for one timer: the motion value the ring draws, and the ref of the element that carries
// `data-pv-progress` (the source of the last change, which journeys read).
export function useProgress<E extends HTMLElement>(
  progress: number,
  timer: {id: string; remaining: number; duration?: number | null | undefined; status: string},
): readonly [MotionValue<number>, RefObject<E | null>] {
  const reduced = useReducedMotion() ?? false;
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
      userUntil.current = now + springMs(SPRING.smooth);
    const animation = animate(value, progress, transition);
    return () => {
      animation.stop();
    };
  }, [id, remaining, duration, status, progress, reduced, value]);
  return [value, node] as const;
}
