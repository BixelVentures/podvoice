// Ported from tests/podview/stage-css.test.mjs (the stage's geometry; the CSS staging it also tested is gone: the
// kit stylesheet is committed resolved for the stage in src/styles/kit.css).
import {expect, test} from 'vitest';
import {stageGeometry} from './stage';

test('the stage keeps the canvas scale that fits and stretches to fill the frame (never letterboxed)', () => {
  expect(stageGeometry(1180, 820))
    .toEqual({scale: 1, x: 0, y: 0, width: 1180, height: 820, safe: {top: 0, right: 0, bottom: 0, left: 0}});
  const g = stageGeometry(1180, 764);
  expect(g.scale).toBe(764 / 820);
  expect([g.x, g.y, g.height]).toEqual([0, 0, 820]);
  expect(Math.abs(g.width * g.scale - 1180)).toBeLessThan(1e-9);
  const p = stageGeometry(820, 1180);
  expect(p.width).toBe(1180);
  expect(Math.abs(p.height * p.scale - 1180)).toBeLessThan(1e-9);
  // Safe areas never move the stage (Ro runs under the status bar); they come back in stage px.
  const s = stageGeometry(1180, 820, {top: 24, right: 0, bottom: 20, left: 0});
  expect([s.y, s.scale, s.height, s.safe.top, s.safe.bottom]).toEqual([0, 1, 820, 24, 20]);
});
