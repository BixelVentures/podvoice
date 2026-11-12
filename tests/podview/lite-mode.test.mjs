// Strip mode for weak wall screens (Frameo: RK3126, Android 6, WebView/Chrome 107). Scroll measured
// 14–24 fps with 1.5–2.2 s freezes; the main thread was busy with decorative work during scroll
// (scroll-edge fades re-measured on every scroll event, motion geometry holds, painted effects).
// Strip mode keeps every function and text, and removes that decoration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liteMode, LITE_KEY } from '../../podvoice/gatekeeper/static/podview/ui/lite.js';

const FRAMEO = 'Mozilla/5.0 (Linux; Android 6.0.1; Frame Build/MXC89K; wv) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Version/4.0 Chrome/107.0.5304.36 Safari/537.36';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const storage = (value) => ({ getItem: (key) => (key === LITE_KEY ? value : null) });

test('a weak wall screen (Chrome before 111) gets strip mode automatically', () => {
  assert.equal(liteMode({ userAgent: FRAMEO, storage: storage(null) }), true);
});

test('Mac and iPad keep the full design', () => {
  assert.equal(liteMode({ userAgent: MAC_CHROME, storage: storage(null) }), false);
  assert.equal(liteMode({ userAgent: IPAD, storage: storage(null) }), false);
});

test('a per-screen setting forces strip mode on or off', () => {
  assert.equal(liteMode({ userAgent: IPAD, storage: storage('1') }), true);
  assert.equal(liteMode({ userAgent: FRAMEO, storage: storage('0') }), false);
  const blocked = { getItem() { throw new Error('storage blocked'); } };
  assert.equal(liteMode({ userAgent: FRAMEO, storage: blocked }), true, 'blocked storage falls back to auto');
});

test('strip mode removes painted effects and motion in the delivered stylesheet', async () => {
  const css = await readFile(new URL('../../podvoice/gatekeeper/static/podview/podview.css', import.meta.url), 'utf8');
  const rule = css.match(/html\[data-lite\] \*,[^{]*\{([^}]*)\}/);
  assert.ok(rule, 'strip rule present');
  for (const declaration of ['animation:none!important', 'transition:none!important', 'box-shadow:none!important',
    'backdrop-filter:none!important']) {
    assert.ok(rule[1].includes(declaration), declaration);
  }
});

test('strip mode does not start scroll-edge fades or motion bookkeeping', async () => {
  const source = await readFile(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),
    'utf8');
  const guarded = /if\(!this\.lite\)\{this\.motion\?\?=new SceneMotion\(this\);this\.scrollEdges\?\?=new ScrollEdges/;
  assert.match(source, guarded);
});
