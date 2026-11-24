// PodView's motion tokens (docs/MOTION.md §3.1, §3.11): four durations, three easings and the springs, and the same
// tokens as motion/react transitions. scripts/gen-motion-tokens.mjs writes them as CSS custom properties
// (src/styles/motion-tokens.css); Node runs this file directly there, so it has no runtime imports. Springs run as
// their fitted cubic-bezier over the spring's settle time, as the kit's CSS does (WebKit composites cubic-bezier, never the
// sampled linear() a JS spring would produce).
import type {Transition} from 'motion/react';

export interface SpringSpec {
  duration: number;
  bounce?: number;
}

export const DUR = Object.freeze({tap: 100, quick: 160, base: 240, ambient: 1400, reduced: 150});
export const SPRING = Object.freeze({
  quick: Object.freeze({duration: 0.3, bounce: 0}),
  smooth: Object.freeze({duration: 0.45, bounce: 0}),
  snappy: Object.freeze({duration: 0.4, bounce: 0.15}),
  flick: Object.freeze({duration: 0.5, bounce: 0.2}),
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

// Normalised step response from 0 to 1, starting at rest. t in seconds.
function stepResponse(spec: SpringSpec): (t: number) => number {
  const {omega, zeta} = springParams(spec);
  if (zeta >= 1) return t => 1 - Math.exp(-omega * t) * (1 + omega * t);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const ratio = (zeta * omega) / damped;
  return t => 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ratio * Math.sin(damped * t));
}

// Last time the response is further than eps from rest, sampled every 0.5 ms for up to 5 s.
function settleTime(x: (t: number) => number, eps = 0.001) {
  let last = 0;
  for (let t = 0; t < 5; t += 0.0005) if (Math.abs(x(t) - 1) > eps) last = t;
  return last;
}

// Ramer–Douglas–Peucker on the sampled curve, so linear() stays within the tolerance.
function simplify(values: number[], times: number[], tolerance: number) {
  const keep = [0, values.length - 1];
  const value = (index: number) => values[index] ?? 0;
  const time = (index: number) => times[index] ?? 0;
  const split = (i: number, j: number) => {
    let best = -1;
    let index = -1;
    for (let k = i + 1; k < j; k++) {
      const line = value(i) + ((value(j) - value(i)) * (time(k) - time(i))) / (time(j) - time(i));
      const error = Math.abs(line - value(k));
      if (error > best) {
        best = error;
        index = k;
      }
    }
    if (best > tolerance) {
      keep.push(index);
      split(i, index);
      split(index, j);
    }
  };
  split(0, values.length - 1);
  return keep.sort((a, b) => a - b);
}

const trimNumber = (value: number, digits: number) =>
  value.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

// CSS linear() approximation of a spring plus its settle time (to 0.1 %), which is the CSS duration.
export function springCurve(spec: SpringSpec, {tolerance = 0.004} = {}): {easing: string; ms: number} {
  const x = stepResponse(spec);
  const settle = settleTime(x);
  const samples = 600;
  const times = Array.from({length: samples + 1}, (_, i) => (settle * i) / samples);
  const values = times.map(t => x(t));
  values[samples] = 1;
  const points = simplify(values, times, tolerance).map(i => {
    const value = trimNumber(values[i] ?? 0, 3);
    return i === 0 || i === samples ? value : `${value} ${trimNumber((100 * (times[i] ?? 0)) / settle, 1)}%`;
  });
  return {easing: `linear(${points.join(', ')})`, ms: Math.round(settle * 1000)};
}

// One cubic-bezier per spring bounce, fitted to springCurve() (max error 2 %; tokens.test.ts).
// CSS tokens and every JS animation use these, never linear(): WebKit with Core Animation (the iPad) does not
// accelerate a linear() easing (KeyframeEffect::canBeAccelerated), so it would run on the main thread.
export const SPRING_BEZIER: Readonly<Record<string, string>> = Object.freeze({
  '--pv-spring-0': 'cubic-bezier(.3,.52,.04,1)',
  '--pv-spring-15': 'cubic-bezier(.26,.44,.08,1.16)',
});

// {ms, easing} for a spring: its settle time and the fitted cubic-bezier for its bounce.
export function springBezier(spec: SpringSpec): {ms: number; easing: string} {
  const easing = SPRING_BEZIER[`--pv-spring-${String(Math.round((spec.bounce ?? 0) * 100))}`];
  if (!easing) throw Error(`no fitted cubic-bezier for bounce ${String(spec.bounce)}`);
  return {ms: springCurve(spec).ms, easing};
}

const bezier = (easing: string): [number, number, number, number] => {
  const values = /cubic-bezier\(([^)]+)\)/.exec(easing)?.[1]?.split(',').map(Number) ?? [];
  const [a = 0, b = 0, c = 1, d = 1] = values;
  return [a, b, c, d];
};

const spring = (spec: SpringSpec): Transition => {
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
