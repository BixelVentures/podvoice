// Ported from tests/podview/stage-css.test.mjs: the stage's geometry (its CSS is styles/app.css).
import {expect, test} from 'vitest';
import {stageGeometry} from './stage';

test('the stage keeps the canvas scale that fits, centred sideways and at the top in a taller frame', () => {
  expect(stageGeometry(1180, 820))
    .toEqual({scale: 1, x: 0, y: 0, width: 1180, height: 820});
  const g = stageGeometry(1180, 764);
  expect(g.scale).toBe(764 / 820);
  expect([g.y, g.width, g.height]).toEqual([0, 1180, 820]);
  expect(Math.abs(g.x * 2 + 1180 * g.scale - 1180)).toBeLessThan(1e-9);
  const wide = stageGeometry(1600, 820);
  expect([wide.scale, wide.x, wide.y, wide.width]).toEqual([1, 210, 0, 1180]);
  const p = stageGeometry(820, 1180);
  expect([p.x, p.width, p.height]).toEqual([0, 1180, 820]);
  expect(p.y).toBe(0);
});

// The canvas's 24 px margins (topbar keys 24 from the top, content to 796, edges 24) absorb the safe areas.
const box = (g: ReturnType<typeof stageGeometry>) => ({
  top: g.y + 24 * g.scale, bottom: g.y + 796 * g.scale, left: g.x + 24 * g.scale, right: g.x + 1156 * g.scale,
  stageBottom: g.y + 820 * g.scale, stageRight: g.x + 1180 * g.scale});

test('insets the margins cover leave the stage 1:1 and in place', () => {
  // The wall iPad in HA's Companion app: 0 top (the status bar is outside the web view or hidden), 20 bottom.
  expect(stageGeometry(1180, 820, {top: 0, right: 0, bottom: 20, left: 0}))
    .toEqual({scale: 1, x: 0, y: 0, width: 1180, height: 820});
  // A 24 px status bar over the page: the topbar's keys sit exactly under it, the stage runs beneath it.
  expect(stageGeometry(1180, 820, {top: 24, right: 0, bottom: 20, left: 0}))
    .toEqual({scale: 1, x: 0, y: 0, width: 1180, height: 820});
});

test('a larger inset scales the whole stage down uniformly and keeps every margin clear of it', () => {
  for (const [w, h, inset] of [
    [1180, 820, {top: 48, right: 0, bottom: 20, left: 0}],
    [1180, 820, {top: 24, right: 44, bottom: 34, left: 44}],
    [1366, 1024, {top: 24, right: 0, bottom: 20, left: 0}],
    [1366, 1024, {top: 0, right: 0, bottom: 0, left: 0}],
    [1024, 1366, {top: 24, right: 0, bottom: 20, left: 0}],
    [1180, 760, {top: 30, right: 0, bottom: 30, left: 0}],
  ] as const) {
    const g = stageGeometry(w, h, inset);
    const b = box(g);
    const e = 1e-9;
    expect(b.top).toBeGreaterThanOrEqual(inset.top - e);
    expect(b.bottom).toBeLessThanOrEqual(h - inset.bottom + e);
    expect(b.left).toBeGreaterThanOrEqual(inset.left - e);
    expect(b.right).toBeLessThanOrEqual(w - inset.right + e);
    expect(g.y).toBeGreaterThanOrEqual(-e);
    expect(g.x).toBeGreaterThanOrEqual(-e);
    expect(b.stageBottom).toBeLessThanOrEqual(h + e);
    expect(b.stageRight).toBeLessThanOrEqual(w + e);
    expect(g.scale).toBeLessThanOrEqual(Math.min(w / 1180, h / 820) + e);
  }
  const g = stageGeometry(1180, 820, {top: 48, right: 0, bottom: 20, left: 0});
  expect(g.scale).toBeCloseTo(772 / 796, 9);
  expect(g.y).toBeCloseTo(48 - 24 * g.scale, 9);
  // Room enough: an iPad Pro frame with its status bar keeps the plain fit, centred.
  const pro = stageGeometry(1366, 1024, {top: 24, right: 0, bottom: 20, left: 0});
  expect(pro.scale).toBe(1366 / 1180);
});
