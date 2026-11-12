// Wall screens on old Android WebView (Chrome 107, e.g. a Frameo frame) drop every declaration
// that uses color-mix() or dvh. The delivered PodView must still show tap feedback and surfaces there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addLegacyWebViewFallbacks, createResolver } from '../../scripts/legacy-webview-css.mjs';
import { attachPressedState } from '../../podvoice/gatekeeper/static/podview/ui/pressed-state.js';

const delivered = new URL('../../podvoice/gatekeeper/static/podview/podview.css', import.meta.url);
const MODERN_ONLY = /color-mix\(|\d(?:d|s|l)vh\b/;

function splitDeclarations(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') depth--;
    else if (body[i] === ';' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => [part.slice(0, part.indexOf(':')).trim(), part.slice(part.indexOf(':') + 1)]);
}

test('color-mix resolves to the colour Chrome 111+ would compute', () => {
  const tokens = new Map([
    ['--pv-ink', '#1B1D1C'],
    ['--pv-dark', '#1B1D1C'],
    ['--pv-on-dark', '#F7F5F0'],
    ['--edge', '14%'],
  ]);
  const { lowerValue } = createResolver(tokens);
  assert.equal(lowerValue('color-mix(in srgb,var(--pv-ink) 12%,transparent)'), 'rgba(27,29,28,0.12)');
  assert.equal(lowerValue('color-mix(in srgb,var(--pv-dark) 88%,var(--pv-on-dark))'), 'rgb(53,55,53)');
  assert.equal(lowerValue('inset 0 0 0 1px color-mix(in srgb,currentColor var(--edge),transparent)'),
    'inset 0 0 0 1px rgba(27,29,28,0.14)');
  assert.equal(lowerValue('calc(100dvh - 8px)'), 'calc(100vh - 8px)');
  assert.equal(lowerValue('color-mix(in oklab,red,blue)'), null);
});

test('ordinary declarations keep the modern value last and gain an old-WebView value first', () => {
  const css = ':root{--pv-ink:#1B1D1C}'
    + '.card{height:100dvh;box-shadow:0 2px color-mix(in srgb,var(--pv-ink) 5%,transparent)}';
  assert.equal(addLegacyWebViewFallbacks(css),
    ':root{--pv-ink:#1B1D1C}.card{height:100vh;height:100dvh;'
    + 'box-shadow:0 2px rgba(27,29,28,0.05);box-shadow:0 2px color-mix(in srgb,var(--pv-ink) 5%,transparent)}');
});

test('custom properties fall back in place and keep the modern value behind @supports', () => {
  const css = ':root{--a:#000;--b:#fff}@media (min-width:1px){.t{--surface:color-mix(in srgb,var(--a) 50%,var(--b))}}';
  assert.equal(addLegacyWebViewFallbacks(css),
    ':root{--a:#000;--b:#fff}@media (min-width:1px){.t{--surface:rgb(128,128,128)}'
    + '@supports (color:color-mix(in srgb,red,red)){.t{--surface:color-mix(in srgb,var(--a) 50%,var(--b))}}}');
});

test('the delivered podview.css gives Chrome 107 a usable value before every modern-only declaration', async () => {
  const css = (await readFile(delivered, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const unprotected = [];
  let guarded = 0;
  for (const block of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const declarations = splitDeclarations(block[2]);
    declarations.forEach(([property, value], index) => {
      if (!MODERN_ONLY.test(value)) return;
      const before = declarations.slice(0, index).some(([p, v]) => p === property && !MODERN_ONLY.test(v));
      const insideSupports = /@supports \([^{}]*\)\{[^{}]*$/.test(css.slice(0, block.index + block[1].length));
      if (before || insideSupports) guarded++;
      else unprotected.push(`${block[1].trim().slice(-60)} { ${property}:${value.slice(0, 60)} }`);
    });
  }
  assert(guarded >= 70, `expected the known color-mix/dvh declarations, found ${guarded}`);
  assert.deepEqual(unprotected, []);
});

test('tap feedback uses the button colour without color-mix, so Chrome 107 shows it', () => {
  const handlers = new Map();
  const target = {
    animations: [],
    classList: { add() {}, remove() {} },
    dataset: {},
    disabled: false,
    isConnected: true,
    matches: (selector) => selector.startsWith('button,'),
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {},
    closest: () => null,
    animate(frames, options) {
      const animation = { frames, options, cancel() {}, finished: Promise.resolve() };
      this.animations.push(animation);
      return animation;
    },
  };
  const win = {
    addEventListener: (name, fn) => handlers.set(`win:${name}`, fn),
    removeEventListener() {},
    getComputedStyle: () => ({ boxShadow: 'none', color: 'rgb(27, 29, 28)' }),
  };
  const doc = { defaultView: win, addEventListener() {}, removeEventListener() {} };
  const surface = {
    ownerDocument: doc,
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener() {},
  };
  attachPressedState(surface);
  const event = (type) => ({ type, pointerId: 1, clientX: 0, clientY: 0, button: 0, isPrimary: true,
    composedPath: () => [target, surface] });
  handlers.get('pointerdown')(event('pointerdown'));
  handlers.get('win:pointerup')(event('pointerup'));
  assert.equal(target.animations.length, 1);
  assert.equal(target.animations[0].frames[0].boxShadow, 'inset 0 0 0 999px rgba(27, 29, 28, 0.12)');
});
