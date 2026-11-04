import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../../podvoice/gatekeeper/static/podview/', import.meta.url);
const css = readFileSync(new URL('ui-kit.css', root), 'utf8');
const recipe = readFileSync(new URL('recipe-view.js', root), 'utf8');

test('recipe reading and cooking share the approved numbered-list geometry', () => {
  assert.ok(recipe.includes("number.dataset.recipeStepNumber"), "step numbers use canonical slot");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] ol\{[^}]*list-style:none/.test(css), "approved recipe CSS contract");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] li\{[^}]*grid-template-columns:var\(--pv-icon-s\) minmax\(0,1fr\)/.test(css), "approved recipe CSS contract");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] li>\[data-recipe-step-number\]\{[^}]*grid-column:1;grid-row:1/.test(css), "approved recipe CSS contract");
  assert.ok(/#recipe-view \[data-recipe-layout=reading\] li>:is\(h3,p,button\)\{grid-column:2\}/.test(css), "approved recipe CSS contract");
  // The approved recipe is already full-width. Shared detail inset previously
  // narrowed it a second time and changed instruction wrapping.
  assert.doesNotMatch(css, /\.responses>:is\([^}]*#recipe-view[^}]*\)\[?[^}]*padding-inline:var\(--pv-s2\)/);
});

test('recipe catalog resume, ingredient disclosure, and overview use canonical kit styling', () => {
  assert.ok(/\.pv-kit-listrow\[data-kit-variant=resume\]\[aria-current=true\]\{background:var\(--pv-dark\);color:var\(--pv-on-dark\)\}/.test(css), "approved recipe CSS contract");
  assert.ok(/\.pv-kit-disclosure\[data-kit-layout=card-header\][^{]*\{[^}]*border-radius/.test(css), "approved recipe CSS contract");
  assert.ok(css.includes("#recipe-view .pv-kit.pv-kit-button[data-kit-variant=quiet]{font:var(--pv-t-label)}"), "recipe quiet actions retain approved label typography");
  assert.ok(css.includes("#recipe-view [data-recipe-layout=ingredients]>div:not([hidden]){display:grid"), "ingredient disclosure uses canonical grid");
  assert.ok(/:is\(#home-recipes,#home-radio\)\[data-overview-size=s\]/.test(css), "approved recipe CSS contract");
});
