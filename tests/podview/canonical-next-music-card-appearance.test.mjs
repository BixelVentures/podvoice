import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-redesign.css',import.meta.url),'utf8');
const rules=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body])=>({selectors:selector.trim().split(',').map(s=>s.trim()),body}));
test('disabled, unavailable, pending and selecting/playing cards retain full artwork/text opacity',()=>{
 for(const [state,selector] of [['disconnected/native disabled','.result:disabled'],['unavailable/selection gate','.result[aria-disabled=true]'],['pending','.result[aria-busy=true]'],['selecting','[data-journey=selecting] .result:not([data-chosen=true])'],['playing','[data-journey=playing] .result:not([data-chosen=true])']]){const rule=rules.find(r=>r.selectors.includes(selector));assert.ok(rule,state+' lacks its appearance invariant');assert.match(rule.body,/(?:^|;)\s*opacity\s*:\s*1\s*(?:;|$)/,state+' must not fade the retained surface');}
 // Catch a reintroduced dimming declaration even if the fixed state guard remains elsewhere.
 for(const rule of rules)if(rule.selectors.some(s=>/(?:^|\s)\.result(?::not\([^)]*\)|:[\w-]+|\[[^\]]*\])*$/.test(s))){const opacity=rule.body.match(/(?:^|;)\s*opacity\s*:\s*([^;]+)/);if(opacity)assert.equal(opacity[1].trim(),'1','Whole-card opacity reintroduced in '+rule.selectors.join(','));}
});
test('rejected full-image veil and hover zoom stay removed while playback eligibility remains enforced',()=>{
 const overlays=rules.filter(rule=>rule.selectors.includes('.result::after'));assert.ok(overlays.length);for(const rule of overlays){assert.match(rule.body,/content:\s*none/);assert.match(rule.body,/background:\s*none/);assert.doesNotMatch(rule.body,/gradient|opacity|filter/);}
 for(const rule of rules)if(rule.selectors.some(selector=>selector.includes('.result-art')&&!selector.includes('live-art-fallback'))){assert.doesNotMatch(rule.body,/(?:^|;)\s*(?:filter|opacity)\s*:/);if(rule.selectors.some(selector=>selector.includes(':hover')))assert.doesNotMatch(rule.body,/scale\(/);}
 const runtime=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/music-results.js',import.meta.url),'utf8');assert.ok(runtime.includes('row.disabled=!allowed'));assert.ok(runtime.includes("row.setAttribute('aria-disabled',String(!allowed||!!pendingId))"));assert.ok(runtime.includes("row.setAttribute('aria-busy',String(pending))"));assert.ok(runtime.includes("if(!row.disabled&&row.getAttribute('aria-disabled')!=='true')"));
});
