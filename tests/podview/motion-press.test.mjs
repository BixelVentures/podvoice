import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// P3 press (docs/MOTION.md §3.4) in the delivered stylesheet. The browser journey
// tests/browser/press_actual_e2e.cjs measures the same thing frame by frame.
const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/podview.css',import.meta.url),'utf8')
 .replace(/\/\*[\s\S]*?\*\//g,'');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({
 selector:selector.replace(/\s+/g,' ').trim(),body:body.replace(/\s+/g,' ').trim()}));
const pressed=rules.filter(rule=>rule.selector.includes('.is-pressed'));

test('one press rule scales on touch-down in --pv-dur-tap with the overlay at once',()=>{
 const owner=pressed.filter(rule=>/(^|[;\s])scale:/.test(rule.body));
 assert.equal(owner.length,1,owner.map(rule=>rule.selector).join('\n'));
 assert.match(owner[0].body,/scale:var\(--pv-press-scale\)!important/);
 assert.match(owner[0].body,/transition:scale var\(--pv-dur-tap\) var\(--pv-ease-out\),box-shadow 0s!important/);
});

test('release and cancel spring back on --pv-spring-quick and fade the overlay in --pv-dur-quick',()=>{
 const rest=rules.find(rule=>rule.selector==='body :is(button,a[href],summary,[role=button])'&&rule.body.includes('transition'));
 assert.ok(rest);
 assert.equal(rest.body,'transition:scale var(--pv-spring-quick),box-shadow var(--pv-dur-quick) var(--pv-ease-out)!important');
 assert.ok(!rules.some(rule=>rule.body.includes('transition-property:filter')),'no rule drops scale from the release');
});

test('tiles and cards .97, buttons .98, small icon buttons none, reduced motion none',()=>{
 const scale=selector=>rules.find(rule=>rule.selector.startsWith(selector)&&rule.body.startsWith('--pv-press-scale'))?.body;
 assert.equal(scale(':where(button,a[href],summary,[role=button])'),'--pv-press-scale:.98');
 assert.equal(scale(':where(.pv-tile,.pv-card,.pv-hero'),'--pv-press-scale:.97');
 assert.equal(scale(':where(.round:not(.main-control)'),'--pv-press-scale:1');
 assert.equal(scale(':root[data-pv-motion=reduced] body'),'--pv-press-scale:1');
});

test('press never uses filter, is never matched by :has() and is not animated from JS',()=>{
 for(const rule of pressed)assert.ok(!/filter:brightness/.test(rule.body),rule.selector);
 for(const rule of rules)assert.ok(!/:has\([^)]*is-pressed/.test(rule.selector),rule.selector);
 const source=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui/pressed-state.js',import.meta.url),'utf8');
 assert.ok(!/\.animate\(|boxShadow|getComputedStyle/.test(source));
});
