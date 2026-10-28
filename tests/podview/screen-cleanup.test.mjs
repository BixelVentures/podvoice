import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../podvoice/gatekeeper/static/podview/widget-view.js', import.meta.url),'utf8');
const screen = source.slice(source.indexOf(' renderScreenSettings(){'),source.indexOf(' scheduleClock(){'));
test('screen settings do not offer diagnostic download or enrollment as rename',()=>{
 assert.doesNotMatch(screen,/Gem fejllog|Navngiv skærmen|screenEnrollmentLink|screenDiagnosticButton|setup\.html/);
 assert.match(screen,/screen-device-wifi-row'\)\.hidden=true/);
});
