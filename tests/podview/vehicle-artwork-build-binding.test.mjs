import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {composeStyles,stylesheetSources} from '../../scripts/build-assets.mjs';

test('canonical vehicle artwork sizing is included in generated styles',async()=>{
 const root=new URL('../../podvoice/gatekeeper/static/podview/',import.meta.url);
 const files=new Map(await Promise.all(stylesheetSources.map(async name=>[name,await readFile(new URL(name,root),'utf8')])));
 const source=files.get('ui-kit.css');
 for(const rule of ['.vehicle-artwork{min-height:160px;grid-template-rows:160px auto}', '.vehicle-artwork>.vehicle-image{max-height:160px}', '.vehicle-content{grid-template-columns:minmax(0,1fr) calc(4 * var(--pv-hit))}']) assert.ok(source.includes(rule),rule);
 const generated=await readFile(new URL('podview.css',root),'utf8');
 const sha=createHash('sha256').update(source).digest('hex');
 assert.ok(generated.includes(`Source: ui-kit.css · SHA256 ${sha}`));
 for(const rule of ['.vehicle-artwork{min-height:160px;grid-template-rows:160px auto}', '.vehicle-artwork>.vehicle-image{max-height:160px}', '.vehicle-content{grid-template-columns:minmax(0,1fr) calc(4 * var(--pv-hit))}']) assert.ok(generated.includes(rule),rule);
});
