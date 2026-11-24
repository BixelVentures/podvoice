// PodView's motion tokens (docs/MOTION.md §2): the springs every spatial move runs on, short tweens for opacity and
// colour, and the durations and easings CSS still uses for press feedback. scripts/gen-motion-tokens.mjs writes DUR and
// EASE as CSS custom properties (src/styles/motion-tokens.css); Node runs this file directly there, so it has no
// runtime imports.
//
// Springs are real motion/react springs (`type: 'spring'`), given as physics (stiffness, damping, mass 1) computed from
// Apple's duration/bounce model. Physics, not motion's own `visualDuration`: a time-defined spring in motion ignores the
// velocity it inherits, and a spring that is retargeted mid-flight (a tap during a transition, the release of a swipe)
// must keep the velocity it has.
import type {Transition} from 'motion/react';

export interface SpringSpec {
  // Perceptual duration in seconds (Apple's `duration`): when the move looks done.
  duration: number;
  // Apple's bounce: 0 is critically damped, 0.15 not yet bouncy, 0.3 clearly bouncy.
  bounce?: number;
}

export const DUR = Object.freeze({tap: 100, quick: 160, base: 240, ambient: 1400, reduced: 150});
export const SPRING = Object.freeze({
  // A screen push, a back and the settle of a swipe back.
  page: Object.freeze({duration: 0.35, bounce: 0}),
  // Small moves: a selection indicator, a dialog, a toggle.
  quick: Object.freeze({duration: 0.25, bounce: 0}),
  // Lists and layout, a value travelling (a timer's ring after +1 min).
  smooth: Object.freeze({duration: 0.4, bounce: 0}),
  // An arrival that should catch the eye (the alarm, a new answer's key).
  snappy: Object.freeze({duration: 0.35, bounce: 0.15}),
  // Only after a gesture with momentum (a sheet thrown back into place).
  flick: Object.freeze({duration: 0.45, bounce: 0.2}),
});
export const EASE = Object.freeze({
  out: 'cubic-bezier(.2,0,0,1)',
  in: 'cubic-bezier(.4,0,1,1)',
  inout: 'cubic-bezier(.45,0,.55,1)',
});

// Apple's duration/bounce model with mass 1: k=(2π/duration)², ζ=1−bounce, c=2ζω.
export function springParams({duration, bounce = 0}: SpringSpec) {
  const omega = (2 * Math.PI) / duration;
  const zeta = 1 - bounce;
  return {k: omega * omega, c: 2 * zeta * omega, zeta, omega};
}

const round = (value: number) => Math.round(value * 100) / 100;

// A spec as a motion/react spring transition.
export function spring(spec: SpringSpec): Transition {
  const {k, c} = springParams(spec);
  return {type: 'spring', stiffness: round(k), damping: round(c), mass: 1};
}

const bezier = (easing: string): [number, number, number, number] => {
  const values = /cubic-bezier\(([^)]+)\)/.exec(easing)?.[1]?.split(',').map(Number) ?? [];
  const [a = 0, b = 0, c = 1, d = 1] = values;
  return [a, b, c, d];
};

export const TRANSITION = {
  page: spring(SPRING.page),
  quick: spring(SPRING.quick),
  smooth: spring(SPRING.smooth),
  snappy: spring(SPRING.snappy),
  flick: spring(SPRING.flick),
  // Opacity and colour: a short tween, never a spring.
  fade: {type: 'tween', duration: DUR.quick / 1000, ease: bezier(EASE.out)} as Transition,
  // A whole-screen cross-dissolve (Ro over the panel): calmer than a fade.
  dissolve: {type: 'tween', duration: 0.4, ease: bezier(EASE.out)} as Transition,
  // P5: a countdown tick runs linear over its interval, so a ring never stops or jumps.
  tick: (ms = 1000): Transition => ({type: 'tween', duration: ms / 1000, ease: 'linear'}),
  // Reduced motion: short and linear, never a spring and never a move.
  reduced: {type: 'tween', duration: DUR.reduced / 1000, ease: 'linear'} as Transition,
  tap: {type: 'tween', duration: DUR.tap / 1000, ease: bezier(EASE.out)} as Transition,
  // A calm loop (a breathing material, a pulse): `periods` ambient periods per cycle, for ever.
  ambient: (periods = 1): Transition => ({
    type: 'tween', duration: (periods * DUR.ambient) / 1000, ease: bezier(EASE.inout), repeat: Infinity,
  }),
};

// How long a spring looks busy (its perceptual duration, ms): windows that must outlast a move (useProgress).
export const springMs = (spec: SpringSpec) => spec.duration * 1000;
