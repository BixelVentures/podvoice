import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// P3 press (docs/MOTION.md) in the delivered stylesheet. ui/pressed-state.js animates the pressed control with Web
// Animations; tests/podview/root-pressed-state.test.mjs covers the timing and tests/browser/press_actual_e2e.cjs
// measures it frame by frame.
const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/podview.css',import.meta.url),'utf8')
 .replace(/\/\*[\s\S]*?\*\//g,'');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({
 selector:selector.replace(/\s+/g,' ').trim(),body:body.replace(/\s+/g,' ').trim()}));
const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui/pressed-state.js',import.meta.url),
 'utf8');

test('no selector depends on a press: no class, attribute or custom property is written for it',()=>{
 for(const marker of ['.is-pressed','data-pv-circle','data-pv-pointer-focus','--pv-press-x'])
  assert.equal(rules.filter(rule=>rule.selector.includes(marker)||rule.body.includes(marker)).length,0,marker);
 assert.doesNotMatch(source,/classList|setAttribute|removeAttribute|dataset\.\w+\s*=|\.style\b|setProperty/);
});

test('native :active cannot hold the scale the press animates',()=>{
 const active=rules.find(rule=>rule.selector===':is(button,a[href],summary,[role=button]):active');
 assert.equal(active.body,'filter:none!important;transform:none!important');
 assert.ok(!rules.some(rule=>/:active/.test(rule.selector)&&/(^|[;\s])scale:[^;]*!important/.test(rule.body)));
});

test('the flat circle is a resting ::after the animation places, grows and fades',()=>{
 const circle=rules.find(rule=>rule.selector===':is(.pv-widget,[data-pv-press=flat])::after');
 assert.match(circle.body,/border-radius:50%/);assert.match(circle.body,/translate:-50% -50%/);
 assert.match(circle.body,/opacity:0/);assert.doesNotMatch(circle.body,/var\(--pv-press/);
});

test('pointer focus hides its ring through :focus-visible, not a marker',()=>{
 assert.ok(rules.some(rule=>rule.selector===':is(button,a[href],summary,[role=button]):focus:not(:focus-visible)'&&
  rule.body==='outline:none!important'));
});

test('no double-tap zoom delay on any tap',()=>{
 assert.ok(rules.some(rule=>rule.selector==='html'&&rule.body==='touch-action:manipulation'));
});
