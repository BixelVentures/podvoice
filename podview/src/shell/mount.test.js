// The HA kiosk integration (ingress-kiosk.js) finds PodView's page by its pv-widget-host. The bundle evaluates that
// module before the shell mounts, so the mount starts it once the host is in the page (home_events_actual_e2e.cjs:
// »Administration« in »Skærm og enhed« navigates HA's panel).
import {afterEach, test, vi} from 'vitest';
import assert from 'node:assert/strict';
import {mountPage, unmountPage} from './shell-fixture.js';

const seen = vi.hoisted(() => []);
vi.mock('../../ingress-kiosk.js', async original => ({
  ...(await original()),
  startIngress: win => seen.push(win.document.querySelectorAll('pv-widget-host').length),
}));

afterEach(unmountPage);

test('mounting the shell starts the HA kiosk integration with the host in the page', async () => {
  seen.length = 0;
  await mountPage('/view/?room=room');
  assert.deepEqual(seen, [1]);
});
