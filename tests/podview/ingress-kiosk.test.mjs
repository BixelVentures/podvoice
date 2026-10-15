import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the actual PodVoice root loads the same packaged ingress route owner as PodView',()=>{
 const html=readFileSync(new URL('../../podvoice/gatekeeper/static/index.html',import.meta.url),'utf8');
 assert.match(html,/<a class="podview-link" href="view\/">Åbn PodView<\/a>/);
 assert.equal((html.match(/<script type="module" src="view\/ingress-kiosk\.js"><\/script>/g)||[]).length,1);
 assert.doesNotMatch(html,/var path = event\.data\.route && event\.data\.route\.path/);
});
