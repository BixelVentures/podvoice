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
  assert.equal(resolveStage('.f{height:calc(100dvh - 10px);width:50vw}'), '.f{height:calc(820px - 10px);width:590px}');
});

test('the delivered stylesheet has no frame-dependent layout', async () => {
  const css = await readFile(new URL('../../podvoice/gatekeeper/static/podview/podview.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /@media[^{]*(width|height)/);
  assert.doesNotMatch(css, /\d(d|s|l)?v(h|w)\b/);
});

test('the stage scales uniformly, as large as possible, centred', () => {
  assert.deepEqual(stageGeometry(1180, 820), {scale: 1, x: 0, y: 0});
  const g = stageGeometry(1180, 764);
  assert.equal(g.scale, 764 / 820); assert.equal(g.y, 0); assert.ok(Math.abs(g.x - (1180 - 1180 * g.scale) / 2) < 1e-9);
  assert.equal(stageGeometry(820, 1180).x, 0);
});
