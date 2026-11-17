import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveStage} from '../../scripts/stage-css.mjs';
import {stageGeometry} from '../../podvoice/gatekeeper/static/podview/ui/stage.js';

test('size queries resolve for the 1180×820 stage; other queries survive', () => {
  const css = '@media(max-width:759px){.a{x:1}}@media (min-width:1000px){.b{x:2}}'
    + '@media(min-width:1000px) and (prefers-reduced-motion:reduce){.c{x:3}}'
    + '@media(max-width:759px),(max-height:640px){.d{x:4}}@media(min-width:1000px) and (max-height:760px){.e{x:5}}';
  assert.equal(resolveStage(css), '.b{x:2}@media (prefers-reduced-motion:reduce){.c{x:3}}');
  assert.equal(resolveStage('.f{height:calc(100dvh - 10px);width:50vw}'),
    '.f{height:calc(var(--pv-stage-h,820px) - 10px);width:calc(var(--pv-stage-w,1180px) * 0.5)}');
});

test('the delivered stylesheet has no frame-dependent layout', async () => {
  const css = await readFile(new URL('../../podvoice/gatekeeper/static/podview/podview.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /@media[^{]*(width|height)/);
  assert.doesNotMatch(css, /\d(d|s|l)?v(h|w)\b/);
});

test('the stage keeps the canvas scale that fits and stretches to fill the frame (never letterboxed)', () => {
  assert.deepEqual(stageGeometry(1180, 820),
    {scale: 1, x: 0, y: 0, width: 1180, height: 820, safe: {top: 0, right: 0, bottom: 0, left: 0}});
  const g = stageGeometry(1180, 764);
  assert.equal(g.scale, 764 / 820); assert.equal(g.x, 0); assert.equal(g.y, 0);
  assert.equal(g.height, 820); assert.ok(Math.abs(g.width * g.scale - 1180) < 1e-9);
  const p = stageGeometry(820, 1180);
  assert.equal(p.width, 1180); assert.ok(Math.abs(p.height * p.scale - 1180) < 1e-9);
  // Safe areas never move the stage (Ro runs under the status bar); they come back in stage px.
  const s = stageGeometry(1180, 820, {top: 24, right: 0, bottom: 20, left: 0});
  assert.equal(s.y, 0); assert.equal(s.scale, 776 / 820);
  assert.ok(Math.abs(s.height * s.scale - 820) < 1e-9); assert.ok(Math.abs(s.safe.top - 24 / s.scale) < 1e-9);
});
