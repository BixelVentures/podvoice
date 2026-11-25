// @vitest-environment node
// The motion tokens (docs/MOTION.md §2): springs are motion/react physics springs from Apple's duration/bounce model,
// tweens only for opacity and colour, and the CSS tokens (src/styles/motion-tokens.css) carry only durations and
// easings; that the file is exactly what the generator writes is scripts/gen-motion-tokens.test.mjs.
import {expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DUR, EASE, SPRING, TRANSITION, spring, springParams} from './tokens';

const css = readFileSync(fileURLToPath(new URL('../../styles/motion-tokens.css', import.meta.url)), 'utf8');
const token = (name: string) => {
  const match = new RegExp(`${name}: ([^;]+);`).exec(css);
  if (!match?.[1]) throw Error(`${name} is not declared`);
  return match[1];
};

// Critically damped or underdamped step response from rest (mass 1), as motion/react integrates it.
const response = (k: number, c: number) => (t: number) => {
  const omega = Math.sqrt(k);
  const zeta = c / (2 * omega);
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
};

test('every spatial token is a physics spring (velocity is kept when it is retargeted)', () => {
  for (const name of ['page', 'quick', 'smooth', 'snappy', 'flick'] as const) {
    const transition = TRANSITION[name] as {type: string; stiffness: number; damping: number; mass: number};
    expect(transition.type).toBe('spring');
    expect(transition).not.toHaveProperty('visualDuration');
    expect(transition).not.toHaveProperty('duration');
    expect(transition.mass).toBe(1);
    expect(transition).toEqual(spring(SPRING[name]));
  }
});

test('a screen transition looks done within 350 ms and never overshoots', () => {
  const {stiffness, damping} = TRANSITION.page as {stiffness: number; damping: number};
  const x = response(stiffness, damping);
  expect(x(0.35)).toBeGreaterThan(0.98);
  for (let t = 0; t < 2; t += 0.005) expect(x(t)).toBeLessThanOrEqual(1 + 1e-9);
  expect(SPRING.page.bounce).toBe(0);
});

test('fades and reduced motion are short tweens', () => {
  expect(TRANSITION.fade).toMatchObject({type: 'tween', duration: DUR.quick / 1000});
  expect(TRANSITION.reduced).toEqual({type: 'tween', duration: 0.15, ease: 'linear'});
  expect(TRANSITION.ambient(2)).toMatchObject({type: 'tween', duration: 2.8, repeat: Infinity});
});

test('CSS carries the press-feedback durations and easings only', () => {
  expect(DUR).toEqual({tap: 120, quick: 160, base: 240, ambient: 1400, reduced: 150});
  for (const [name, ms] of Object.entries(DUR)) expect(token(`--duration-pv-${name}`)).toBe(`${String(ms)}ms`);
  for (const [name, value] of Object.entries(EASE)) expect(token(`--ease-pv-${name}`)).toBe(value);
  expect(css).not.toContain('spring');
  expect(css).not.toContain('linear(');
});

test('spring parameters follow the duration/bounce model', () => {
  const page = springParams(SPRING.page);
  expect(Math.abs(page.k - 322.27)).toBeLessThan(0.1);
  expect(Math.abs(page.c - 35.9)).toBeLessThan(0.01);
  expect(page.zeta).toBe(1);
  const snappy = springParams(SPRING.snappy);
  expect(Math.abs(snappy.zeta - 0.85)).toBeLessThan(1e-9);
  const flick = springParams(SPRING.flick);
  expect(Math.abs(flick.zeta - 0.8)).toBeLessThan(1e-9);
});
