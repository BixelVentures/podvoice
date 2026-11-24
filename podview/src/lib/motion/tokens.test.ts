// @vitest-environment node
// Ported from tests/podview/motion-tokens.test.mjs (node:test). Same assertions, on tokens.ts and the generated
// src/styles/motion-tokens.css (Tailwind theme names); that the file is exactly what the generator writes is scripts/gen-motion-tokens.test.mjs.
import {expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DUR, EASE, SPRING, SPRING_BEZIER, springCurve, springParams} from './tokens';

const css = readFileSync(fileURLToPath(new URL('../../styles/motion-tokens.css', import.meta.url)), 'utf8');
const token = (name: string) => {
  const match = new RegExp(`${name}: ([^;]+);`).exec(css);
  if (!match?.[1]) throw Error(`${name} is not declared`);
  return match[1];
};
const curve = (easing: string) => easing.slice(13, -1).split(',').map(Number);
// A CSS cubic-bezier's progress at time t (0..1), by bisection on x.
const bezierAt = (easing: string, t: number) => {
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = curve(easing);
  let lo = 0;
  let hi = 1;
  let s = 0;
  for (let k = 0; k < 40; k++) {
    s = (lo + hi) / 2;
    const x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3;
    if (x < t) lo = s;
    else hi = s;
  }
  return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3;
};
// The spring's linear() points as [time, progress]; a point without a position sits evenly between its neighbours.
const springAt = (easing: string, t: number) => {
  const parts = easing.slice(7, -1).split(', ').map(part => part.split(' '));
  const points = parts.map(([v, at], i) => [at ? parseFloat(at) / 100 : i / (parts.length - 1), Number(v)] as const);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && t <= b[0]) return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0] || 1);
  }
  return 1;
};

test('CSS springs are cubic-beziers fitted to the JS springCurve (WebKit never accelerates linear())', () => {
  expect(token('--ease-pv-spring-0')).toBe(SPRING_BEZIER['--pv-spring-0']);
  expect(token('--ease-pv-spring-15')).toBe(SPRING_BEZIER['--pv-spring-15']);
  expect(css).not.toContain('linear(');
  for (const [name, key] of [['quick', '--pv-spring-0'], ['smooth', '--pv-spring-0'], ['snappy', '--pv-spring-15']] as
    const) {
    const fitted = SPRING_BEZIER[key] ?? '';
    for (let t = 0.02; t < 1; t += 0.02) {
      expect(Math.abs(bezierAt(fitted, t) - springAt(springCurve(SPRING[name]).easing, t))).toBeLessThan(0.03);
    }
  }
  // Bounce 0 is critically damped: the curve never passes the target.
  for (let t = 0; t <= 1; t += 0.005) expect(bezierAt(SPRING_BEZIER['--pv-spring-0'] ?? '', t)).toBeLessThanOrEqual(1 + 1e-9);
});

test('the curves are the ones approved in docs/MOTION.md §2', () => {
  expect(springCurve(SPRING.quick).easing).toBe('linear(0, 0.005 1.2%, 0.02 2.3%, 0.083 5.2%, 0.164 7.8%, ' +
    '0.46 16.8%, 0.555 20.2%, 0.638 23.5%, 0.708 26.8%, 0.766 30.2%, 0.816 33.7%, 0.86 37.5%, 0.899 42%, ' +
    '0.929 46.8%, 0.953 52.3%, 0.971 58.5%, 0.991 73.7%, 1)');
  expect(springCurve(SPRING.snappy).easing).toBe('linear(0, 0.006 1.3%, 0.024 2.7%, 0.054 4.2%, 0.097 5.8%, ' +
    '0.187 8.7%, 0.516 18.2%, 0.612 21.3%, 0.695 24.5%, 0.766 27.7%, 0.824 30.8%, 0.873 34.2%, 0.913 37.7%, ' +
    '0.946 41.5%, 0.971 45.8%, 0.989 50.5%, 1 55.8%, 1.006 68%, 1)');
  expect((['quick', 'smooth', 'snappy'] as const).map(name => springCurve(SPRING[name]).ms)).toEqual([441, 661, 557]);
});

test('durations and easings are the four plus reduced, and three curves', () => {
  expect(DUR).toEqual({tap: 100, quick: 160, base: 240, ambient: 1400, reduced: 150});
  for (const [name, ms] of Object.entries(DUR)) expect(token(`--duration-pv-${name}`)).toBe(`${String(ms)}ms`);
  for (const [name, value] of Object.entries(EASE)) expect(token(`--ease-pv-${name}`)).toBe(value);
  expect(token('--ease-pv-out')).toBe('cubic-bezier(.2,0,0,1)');
});

test('spring parameters follow the duration/bounce model', () => {
  const smooth = springParams({duration: 0.45, bounce: 0});
  expect(Math.abs(smooth.k - 195.0)).toBeLessThan(0.1);
  expect(Math.abs(smooth.c - 27.93)).toBeLessThan(0.01);
  expect(smooth.zeta).toBe(1);
  const quick = springParams(SPRING.quick);
  const snappy = springParams(SPRING.snappy);
  const flick = springParams(SPRING.flick);
  expect(Math.abs(quick.k - 438.6)).toBeLessThan(0.1);
  expect(Math.abs(quick.c - 41.89)).toBeLessThan(0.01);
  expect(Math.abs(snappy.k - 246.7)).toBeLessThan(0.1);
  expect(Math.abs(snappy.c - 26.7)).toBeLessThan(0.01);
  expect(Math.abs(snappy.zeta - 0.85)).toBeLessThan(1e-9);
  expect(Math.abs(flick.k - 157.9)).toBeLessThan(0.1);
  expect(Math.abs(flick.c - 20.11)).toBeLessThan(0.01);
});
