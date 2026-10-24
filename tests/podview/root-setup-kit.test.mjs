import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/setup.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/setup.css',import.meta.url),'utf8');
const fields=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui/library/library.css',import.meta.url),'utf8');
test('setup loads canonical foundations and retains native form/status owners',()=>{
 assert.ok(html.indexOf('ui/components.css')<html.indexOf('ui-kit.css'));
 assert.ok(html.indexOf('ui-kit.css')<html.indexOf('setup.css'));
 for(const id of ['pair-form','device-name','pair-submit','pair-status','approval-actions'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
 assert.match(html,/class="pv-kit pv-kit-card pv-card"/);
 assert.match(html,/class="pv-kit pv-form-field" id="device-name"/);
 assert.match(html,/data-kit-variant="primary" id="pair-submit"[^>]*disabled/);
 assert.match(html,/role="status" aria-live="polite"/);
 assert.match(css,/width:min\(520px,100%\);padding:var\(--pv-s4\)/);
 assert.doesNotMatch(css,/#(?:[0-9a-f]{3}){1,2}\b|Arial|border-radius|button\s*\{/i);
});
test('native field primary size is opt-in and existing dialog size remains unchanged',()=>{
 assert.match(fields,/\.pv-form-field,dialog\.pv-component input[^\n]+min-height:52px/);
 assert.match(fields,/\.pv-form-field\{min-height:var\(--pv-hit-primary\);font:var\(--pv-t-body\)\}/);
});

test('screen information gives labels their own column and separates the shared Button link',()=>{
 const kit=readFileSync(new URL('../../podvoice/gatekeeper/static/podview/ui-kit.css',import.meta.url),'utf8');
 assert.match(kit,/\.screen-device-network>\.pv-kit-listrow\{grid-template-columns:max-content minmax\(0,1fr\);align-items:start/);
 assert.match(kit,/\.screen-device-network>\.pv-kit-listrow>span:last-child\{min-width:0;overflow-wrap:anywhere/);
 assert.match(kit,/#screen-device-more>\.pv-kit-button\{margin-top:var\(--pv-s2\)\}/);
 assert.match(kit,/\.pv-btn\{[^}]*text-decoration:none/);
});
