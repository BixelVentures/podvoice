import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/index.html',import.meta.url),'utf8');
test('changing weather readings name themselves rather than being masked by a static action label',()=>{
 for(const id of ['header-weather','photo-weather']){const tag=html.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`))?.[0];assert.ok(tag);assert.doesNotMatch(tag,/aria-label=/);}
});
test('overview action name includes its visible title and generic activity host has no prohibited accessible name',()=>{
 const button=html.match(/<button\b[^>]*id="now-rest"[^>]*>([^<]+)<\/button>/);assert.ok(button);assert.ok(button[0].match(/aria-label="([^"]+)"/)[1].includes(button[1]));const activity=html.match(/<span\b[^>]*class="header-activity"[^>]*>/)?.[0];assert.ok(activity);assert.doesNotMatch(activity,/aria-label(?:ledby)?=/);
});
