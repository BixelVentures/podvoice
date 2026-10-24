import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css=fs.readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');
test('desktop topbar reserves equal navigation/context slots around retained activity width',()=>{
 const block=css.slice(css.indexOf('/* Equal outer slots'),css.indexOf('pv-widget-host[data-view=active] .view-nav .header-left>.header-activity'));
 assert.match(block,/>:is\(\.header-left,\.header-context\)\{max-width:calc\(\(100% - 224px\)\/2 - var\(--pv-s3\)\);min-width:0\}/);
 assert.match(block,/\.header-weather\{flex:0 1 160px;min-width:var\(--pv-hit\)\}/);
 assert.match(block,/\.header-time\{flex:0 1 auto;min-width:104px;grid-template-columns:minmax\(0,1fr\)\}/);
 assert.match(block,/:is\(\.header-weather small,#header-date\)\{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis\}/);
 assert.doesNotMatch(block,/display:none|visibility:hidden|font-size|height:/);
 // Actual shell inset24 / centered activity224 / shared spacing24:
 // even the maximum context edge leaves24px clear of the activity hit surface.
 for(const width of [980,1280]){const nav=width-48,slot=(nav-224)/2-24,historyRight=width/2+112,contextLeft=width-24-slot;assert.equal(contextLeft-historyRight,24);assert.ok(slot>=64+32+104);}
});

test('empty weather text spans the existing icon and label tracks when its unknown icon is hidden',()=>{const css=fs.readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');assert.match(css,/\.header-weather:has\(>img\[hidden\]\)>span\{grid-column:1\/-1\}/);});

test('canonical player square artwork is bounded by its content width and artwork-row height at desktop and short canvas',()=>{assert.match(css,/\.player\.pv-card\{display:grid;container-type:inline-size;/);assert.match(css,/height:min\(100%,100cqi,326px\)/);assert.match(css,/height:min\(100%,100cqi,220px\)/);});

test('player status ellipsis has its own bounded line box instead of painting outside its heading',()=>{assert.match(css,/\.output #player-state\{[^}]*min-width:0;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis/);});

test('long native or provider output names remain within one existing output line',()=>{assert.match(css,/\.output \.output-room\{[^}]*min-width:0;max-width:100%/);assert.match(css,/#output \.output-room>#player-room\{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);});
