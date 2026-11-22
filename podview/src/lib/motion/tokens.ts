// PodView's motion tokens (ui/motion.js, docs/MOTION.md) as motion/react transitions. Springs run as their fitted
// cubic-bezier over the spring's settle time, as the kit's CSS does (WebKit composites cubic-bezier, never the
// sampled linear() a JS spring would produce).
import type {Transition} from 'motion/react';
import {DUR, SPRING, springBezier} from '../../../ui/motion.js';

const bezier = (easing: string): [number, number, number, number] => {
  const values = /cubic-bezier\(([^)]+)\)/.exec(easing)?.[1]?.split(',').map(Number) ?? [];
  const [a = 0, b = 0, c = 1, d = 1] = values;
  return [a, b, c, d];
};

const spring = (spec: {duration: number; bounce: number}): Transition => {
  const {ms, easing} = springBezier(spec);
  return {duration: ms / 1000, ease: bezier(easing)};
};

// The same timing for a Web Animation (a pseudo-element motion/react cannot reach).
export function waapiTiming(transition: Transition): KeyframeAnimationOptions {
  const {duration = 0, ease} = transition as {duration?: number; ease?: unknown};
  const easing = Array.isArray(ease) ? `cubic-bezier(${ease.join(',')})` : typeof ease === 'string' ? ease : 'linear';
  return {duration: duration * 1000, easing};
}

export const TRANSITION = {
  quick: spring(SPRING.quick),
  smooth: spring(SPRING.smooth),
  // P5: a countdown tick runs linear over its interval, so a ring never stops or jumps.
  tick: (ms = 1000): Transition => ({duration: ms / 1000, ease: 'linear'}),
  // Reduced motion: short and linear, never a spring.
  reduced: {duration: DUR.reduced / 1000, ease: 'linear'} as Transition,
  tap: {duration: DUR.tap / 1000, ease: bezier('cubic-bezier(.2,0,0,1)')} as Transition,
};
