import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),'utf8');
const screen = source.slice(source.indexOf(' renderScreenSettings(){'),source.indexOf(' scheduleClock(){'));
test('screen settings keep explicit access recovery separate from diagnostics and rename',()=>{
 assert.doesNotMatch(screen,/Gem fejllog|Navngiv skærmen|screenDiagnosticButton/);
 assert.match(screen,/Gendan skærmens adgang/);
 assert.match(screen,/new URLSearchParams\(\{room,enrollment:'1'\}\)/);
 assert.match(screen,/screen-device-wifi-row'\)\.hidden=true/);
});
