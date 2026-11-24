// Ported from tests/podview/frame-meter.test.mjs: the summary and the kind of motion. The meter now reads the panel's
// centred screen instead of the wall page's host, and hands its sessions to the panel's health report.
import {expect, test} from 'vitest';
import {inferKind, installFrameMeter, summarizeFrames} from './frame-meter';

test('frame summary counts slow frames, max and p95', () => {
  const deltas = [...Array<number>(18).fill(16.7), 21, 40];
  expect(summarizeFrames(deltas))
    .toEqual({frames: 20, over17: 2, over20: 2, over34: 1, over50: 0, maxFrameMs: 40, p95FrameMs: 21});
  expect(summarizeFrames([]))
    .toEqual({frames: 0, over17: 0, over20: 0, over34: 0, over50: 0, maxFrameMs: null, p95FrameMs: null});
});

test('the kind follows the screen before and after the touch', () => {
  const home = {screen: 'home', rest: false};
  const music = {screen: 'music', rest: false};
  const still = {scrolled: false, animations: 0};
  expect(inferKind(home, music, still)).toBe('push');
  expect(inferKind(music, home, still)).toBe('pop');
  expect(inferKind(home, {screen: 'home', rest: true}, still)).toBe('ro-open');
  expect(inferKind({screen: 'home', rest: true}, home, still)).toBe('ro-close');
  expect(inferKind(home, home, {scrolled: true, animations: 0})).toBe('scroll');
  expect(inferKind(home, home, {scrolled: false, animations: 2})).toBe('press');
  expect(inferKind(home, home, still)).toBe('tap');
});

test('idle costs nothing and a touch becomes one session when it settles', async () => {
  const meter = installFrameMeter(window);
  expect([meter.active(), meter.pending()]).toEqual([false, 0]);
  window.dispatchEvent(new PointerEvent('pointerdown', {clientX: 10, clientY: 10}));
  expect(meter.active()).toBe(true);
  window.dispatchEvent(new PointerEvent('pointerup', {clientX: 10, clientY: 10}));
  await new Promise(resolve => setTimeout(resolve, 600));
  expect(meter.active()).toBe(false);
  const [session] = meter.take();
  expect(session?.kind).toBe('tap');
  expect(meter.pending()).toBe(0);
  meter.dispose();
});
