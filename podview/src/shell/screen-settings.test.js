// »Skærm og enhed« (the quick sheet), ported to Vitest with the real page when the shell moved to React:
// - tests/podview/root-screen-settings.test.mjs (a superset of canonical-field88-screen-settings.test.mjs; both
//   deleted),
// - tests/podview/direct-screen-admin.test.mjs and tests/podview/screen-cleanup.test.mjs (deleted).
// Same assertions. The fake host (renderScreenSettings and open() sliced out of widget-view.js onto stub nodes) is the
// real host on the real shell; the stub nodes are the rendered sheet; `host.screenEnrollmentLink` and
// `host.screenAdminLink` are the sheet's two anchors; the sliced close handler is the dialog's own close; the
// assertions on index.html's sheet markup and on renderScreenSettings' source text are made on the rendered sheet;
// a click is a bubbling MouseEvent (React listens at the shell's root), with the same modifiers; the injected
// requestIngressAdmin is a spy on the real one; the fake origin is the page's own.
import {afterEach, test, vi} from 'vitest';
import assert from 'node:assert/strict';
import {mountPage, unmountPage} from './shell-fixture.js';

const admin = vi.hoisted(() => ({handled: true, calls: []}));
vi.mock('../../ingress-kiosk.js', async original => ({
  ...(await original()),
  requestIngressAdmin: win => {
    admin.calls.push(win);
    return admin.handled;
  },
}));

afterEach(() => {
  unmountPage();
  admin.handled = true;
  admin.calls.length = 0;
});

const onLine = value => Object.defineProperty(navigator, 'onLine', {value, configurable: true});
const anchor = (f, text) => [...f.$('screen-device-more').querySelectorAll('a')].find(a => a.textContent === text);
const enrollment = f => anchor(f, 'Gendan skærmens adgang');
const adminLink = f => anchor(f, 'Administration');
const change = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('change'));
};
const click = (node, init = {}) =>
  node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, ...init}));

async function fixture(stage) {
  onLine(true);
  const f = await mountPage(stage ? `/?stage=${stage}` : '/?stage=now');
  // The old fixture's host: a demo page whose own previewStage is the stage under test (none: an ordinary menu).
  f.host.previewStage = stage;
  f.host.state = {
    ...f.host.state,
    music: {...f.host.state.music, playback: {...f.host.state.music.playback, active: true}},
  };
  return f;
}

test('ordinary browser menu has no hardware authority or fabricated brightness/wifi values', async () => {
  const f = await fixture();
  let effects = 0;
  f.host.screenDeviceAdapter = {
    setBrightness() {
      effects++;
    },
    restart() {
      effects++;
    },
  };
  f.host.renderScreenSettings();
  assert.equal(f.$('screen-device-brightness').disabled, true);
  assert.equal(f.$('screen-device-auto-dim').disabled, true);
  assert.equal(f.$('screen-device-brightness-value').textContent, 'Ikke oplyst');
  assert.equal(f.$('screen-device-brightness').getAttribute('aria-valuetext'), 'Ikke oplyst');
  assert.equal(f.$('screen-device-wifi').textContent, 'Ikke oplyst');
  assert.equal(f.$('screen-device-note').textContent, 'Enhedsstyring er ikke tilsluttet.');
  change(f.$('screen-device-brightness'), '80');
  click(f.$('screen-device-auto-dim'));
  assert.equal(f.host.screenDeviceFixture, undefined);
  assert.equal(effects, 0);
});

test('explicit local specimen permits retained brightness and automatic-dim choices without touching music, timers or hardware', async () => {
  const f = await fixture('screen-device-ready');
  // The stage opened the sheet itself; the old fixture started with it closed.
  f.$('quick-sheet').close();
  const state = f.host.state,
    music = state.music,
    timer = state.timer;
  f.host.openScreenSettings(f.$('header-ro'));
  assert.equal(f.$('quick-sheet').open, true);
  assert.equal(f.$('screen-device-note').textContent, 'Eksempelvisning · ændrer ikke enheden');
  assert.equal(f.$('screen-device-brightness-value').textContent, '60 %');
  assert.equal(f.$('screen-device-auto-dim').getAttribute('aria-checked'), 'true');
  change(f.$('screen-device-brightness'), '75');
  assert.equal(f.$('screen-device-brightness-value').textContent, '75 %');
  assert.equal(f.$('screen-device-brightness').style.getPropertyValue('--pv-slider-progress'), '75%');
  click(f.$('screen-device-auto-dim'));
  assert.equal(f.$('screen-device-auto-state').textContent, 'Fra');
  f.host.openScreenSettings(f.$('header-ro'));
  assert.equal(f.$('screen-device-brightness-value').textContent, '75 %');
  assert.equal(f.$('screen-device-auto-dim').getAttribute('role'), 'switch');
  assert.equal(f.$('screen-device-dimming').getAttribute('data-kit-variant'), 'settings');
  assert.equal(f.host.state, state);
  assert.equal(f.host.state.music, music);
  assert.equal(f.host.state.timer, timer);
});

test('live mode and stale specimen callbacks cannot enable or send a device control', async () => {
  const f = await fixture('screen-device-ready');
  f.host.renderScreenSettings();
  const remembered = {...f.host.screenDeviceFixture};
  f.host.live = true;
  change(f.$('screen-device-brightness'), '88');
  click(f.$('screen-device-auto-dim'));
  assert.deepEqual(f.host.screenDeviceFixture, remembered);
  f.host.renderScreenSettings();
  assert.equal(f.$('screen-device-brightness').disabled, true);
  assert.equal(f.$('screen-device-auto-dim').disabled, true);
  assert.equal(f.$('screen-device-brightness-value').textContent, 'Ikke oplyst');
  assert.equal(f.$('screen-device-wifi').textContent, 'Ikke oplyst');
});

test('browser link and home connection remain distinct from unavailable native Wi-Fi telemetry', async () => {
  const f = await fixture();
  f.host.live = true;
  f.host.liveStatus = 'disconnected';
  f.host.liveSnapshot = {};
  f.host.renderScreenSettings();
  assert.equal(f.$('screen-device-wifi').textContent, 'Ikke oplyst');
  assert.equal(f.$('screen-device-browser').textContent, 'Online');
  assert.equal(f.$('screen-device-home').textContent, 'Forbindelsen er afbrudt');
  assert.equal(
    f.$('screen-device-home').getAttribute('aria-label'),
    'Forbindelsen til hjemmet er afbrudt · viser det seneste.',
  );
  onLine(false);
  f.host.browserOffline = true;
  f.host.renderScreenSettings();
  assert.equal(f.$('screen-device-browser').textContent, 'Offline');
  assert.equal(f.$('screen-device-home').textContent, 'Ingen netværksforbindelse');
  assert.equal(f.$('screen-device-home').getAttribute('aria-label'), 'Ingen netværksforbindelse · viser det seneste.');
  assert.equal(f.$('screen-device-wifi').textContent, 'Ikke oplyst');
  onLine(undefined);
  f.host.browserOffline = false;
  f.host.renderScreenSettings();
  assert.equal(f.$('screen-device-browser').textContent, 'Ikke oplyst');
});

test('native close restores the exact opener and repeated opening installs one listener per action', async () => {
  const f = await fixture('screen-device-ready');
  f.$('quick-sheet').close();
  const clock = f.$('header-ro');
  f.host.openScreenSettings(clock);
  f.host.openScreenSettings(f.$('header-weather'));
  assert.equal(f.host.openers.get('quick-sheet'), clock);
  click(f.$('screen-device-auto-dim'));
  assert.equal(f.host.screenDeviceFixture.autoDim, false);
  f.$('quick-sheet').close();
  await vi.waitFor(() => assert.equal(document.activeElement, clock));
});

test('device recipe removes obsolete motion/Ro/volume controls and never invents shutdown or restart', async () => {
  const f = await fixture();
  const dialog = f.$('quick-sheet');
  for (const id of ['quiet-view', 'screen-rest', 'quick-volume', 'customize-current']) assert.equal(f.$(id), null);
  assert.match(dialog.textContent, /Skærm og enhed/);
  assert.ok(dialog.querySelector('input[type=range]'));
  assert.ok(dialog.querySelector('#screen-device-more'));
  assert.equal(
    [...dialog.querySelectorAll('[id]')].some(node => /restart|shutdown|poweroff|sleep/.test(node.id)),
    false,
  );
  assert.equal(f.$('header-ro').getAttribute('aria-controls'), 'quick-sheet');
});

test('settings row names the trailing switch while network rows and native disclosure remain non-command anatomy', async () => {
  const f = await fixture('screen-device-ready');
  f.host.renderScreenSettings();
  assert.equal(f.$('screen-device-auto-dim').getAttribute('data-kit-variant'), 'settings');
  for (const id of ['screen-device-wifi-row', 'screen-device-browser-row', 'screen-device-home-row']) {
    assert.equal(f.$(id).getAttribute('data-kit-variant'), 'read-only');
    assert.equal(f.$(id).getAttribute('role'), null);
  }
  assert.equal(f.$('screen-device-more-summary').getAttribute('data-kit-variant'), 'disclosure');
  const toggle = f.$('screen-device-auto-dim');
  assert.equal(toggle.getAttribute('aria-labelledby'), 'screen-device-auto-label');
  assert.deepEqual(
    [...toggle.children].map(node => node.id),
    ['screen-device-auto-state'],
  );
  const summary = f.$('screen-device-more-summary');
  const [label, icon] = summary.children;
  assert.equal(summary.children.length, 2);
  assert.equal(label.outerHTML, '<span>Om skærmen</span>');
  assert.deepEqual(
    [icon.localName, icon.getAttribute('src'), icon.getAttribute('alt'), icon.getAttribute('aria-hidden')],
    ['img', 'assets/icons/chevron-down.svg', '', 'true'],
  );
  assert.equal(f.$('screen-device-connection'), null);
});

test('technical network facts and build stay inside the native device disclosure', async () => {
  const f = await fixture();
  const disclosure = f.$('screen-device-more');
  for (const id of [
    'screen-device-network',
    'screen-device-wifi-row',
    'screen-device-browser-row',
    'screen-device-home-row',
    'screen-device-info',
  ]) {
    assert.ok(disclosure.querySelector(`#${id}`));
  }
  assert.equal(disclosure.querySelector('#screen-device-brightness,#screen-device-auto-dim'), null);
});

test('screen settings expose explicit access recovery without log export or diagnostic access', async () => {
  const f = await fixture();
  let reads = 0;
  f.host.live = true;
  f.host.liveStatus = 'connected';
  f.host.liveSnapshot = {bootId: 'boot', roomId: 'room', controllerContinuity: {available: true}};
  f.host.liveTransport = {
    connected: true,
    snapshot: f.host.liveSnapshot,
    diagnostics() {
      reads++;
      return {schema: 'podview.client-diagnostics.v1'};
    },
  };
  for (let i = 0; i < 3; i++) f.host.renderScreenSettings();
  assert.equal(enrollment(f).textContent, 'Gendan skærmens adgang');
  assert.equal(enrollment(f).getAttribute('href'), './setup.html?room=room&enrollment=1');
  assert.equal(enrollment(f).hidden, false);
  assert.equal(f.host.screenDiagnosticButton, undefined);
  assert.equal(reads, 0);
  assert.doesNotMatch(f.$('screen-device-more').textContent, /Gem fejllog|Navngiv skærmen/);
});

test('recovery entry follows current validated room and is hidden without a live room', async () => {
  const f = await fixture();
  f.host.renderScreenSettings();
  assert.equal(enrollment(f).hidden, true);
  f.host.live = true;
  f.host.liveSnapshot = {bootId: 'b', roomId: 'r &1'};
  f.host.renderScreenSettings();
  assert.equal(enrollment(f).getAttribute('href'), './setup.html?room=r+%261&enrollment=1');
  f.host.liveSnapshot = {bootId: 'b', roomId: 'r2'};
  f.host.renderScreenSettings();
  assert.equal(enrollment(f).getAttribute('href'), './setup.html?room=r2&enrollment=1');
  f.host.liveSnapshot = {};
  f.host.renderScreenSettings();
  assert.equal(enrollment(f).hidden, true);
});

test('connection row retains the full accessible status without repeated writes', async () => {
  const f = await fixture();
  f.host.live = true;
  f.host.liveStatus = 'disconnected';
  f.host.liveSnapshot = {};
  f.host.renderScreenSettings();
  const node = f.$('screen-device-home');
  assert.equal(node.getAttribute('role'), 'status');
  assert.equal(node.textContent, 'Forbindelsen er afbrudt');
  assert.equal(node.getAttribute('aria-label'), 'Forbindelsen til hjemmet er afbrudt · viser det seneste.');
  const writes = [];
  const observer = new MutationObserver(records => writes.push(...records));
  observer.observe(f.$('quick-sheet'), {subtree: true, attributes: true, childList: true, characterData: true});
  f.host.renderScreenSettings();
  writes.push(...observer.takeRecords());
  assert.equal(writes.length, 0);
  f.host.liveStatus = 'connecting';
  f.host.renderScreenSettings();
  observer.disconnect();
  assert.equal(node.textContent, 'Genopretter forbindelse…');
  assert.equal(node.getAttribute('aria-label'), 'Genopretter forbindelsen til hjemmet…');
});

// tests/podview/screen-cleanup.test.mjs: what the sheet offers, on the rendered sheet instead of the source text.
test('screen settings keep explicit access recovery separate from diagnostics and rename', async () => {
  const f = await fixture();
  f.host.live = true;
  f.host.liveSnapshot = {bootId: 'b', roomId: 'r'};
  f.host.renderScreenSettings();
  assert.doesNotMatch(f.$('quick-sheet').textContent, /Gem fejllog|Navngiv skærmen/);
  assert.equal(f.host.screenDiagnosticButton, undefined);
  assert.ok(enrollment(f));
  assert.equal(enrollment(f).getAttribute('href'), `./setup.html?${new URLSearchParams({room: 'r', enrollment: '1'})}`);
  assert.equal(f.$('screen-device-wifi-row').hidden, true);
});

// tests/podview/direct-screen-admin.test.mjs
const ingress = path => new URL(path, location.origin);
async function adminFixture(handled = true) {
  admin.handled = handled;
  const f = await fixture();
  f.host.live = true;
  f.host.liveStatus = 'connected';
  return f;
}

test('administration navigation requires current validated same-origin HA ingress', async () => {
  const f = await adminFixture();
  const snapshot = {bootId: 'b', roomId: 'r', admission: {kind: 'ha_ingress', authenticated: true}};
  const transport = {connected: true, snapshot, base: ingress('/api/hassio_ingress/abc/view/api/')};
  f.host.liveSnapshot = snapshot;
  f.host.liveTransport = transport;
  f.host.renderScreenSettings();
  const link = adminLink(f);
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute('href'), ingress('/api/hassio_ingress/abc/').href);
  assert.equal(enrollment(f).hidden, false);
  transport.snapshot = {...snapshot, admission: {...snapshot.admission}};
  f.host.renderScreenSettings();
  assert.equal(link.hidden, false, 'a fresh validated same-scope payload is not a revocation');
  assert.equal(link.getAttribute('href'), ingress('/api/hassio_ingress/abc/').href);
  assert.equal(f.host.liveSnapshot, snapshot, 'navigation rendering does not adopt or alter UI state');
  for (const mutate of [
    () => (transport.connected = false),
    () => (transport.snapshot = {...snapshot, bootId: 'other'}),
    () => (transport.snapshot = {...snapshot, roomId: 'other'}),
    () => (transport.snapshot = {...snapshot, bootId: ''}),
    () => (transport.snapshot = {...snapshot, roomId: ''}),
    () => (transport.snapshot = {...snapshot, admission: {kind: 'ha_ingress', authenticated: false}}),
    () => (transport.snapshot = {...snapshot, admission: {kind: 'ha_ingress', authenticated: true, extra: true}}),
    () => {
      snapshot.admission = {kind: 'ha_ingress', authenticated: false};
    },
    () => {
      snapshot.admission = {kind: 'ha_ingress', authenticated: true, extra: true};
    },
    () => {
      transport.base = new URL('https://evil.example/view/api/');
    },
  ]) {
    transport.connected = true;
    transport.snapshot = snapshot;
    transport.base = ingress('/api/hassio_ingress/abc/view/api/');
    snapshot.admission = {kind: 'ha_ingress', authenticated: true};
    mutate();
    f.host.renderScreenSettings();
    assert.equal(link.hidden, true);
    assert.equal(link.getAttribute('href'), null);
  }
  transport.base = ingress('/api/hassio_ingress/abc/view/api/');
  snapshot.admission = {kind: 'ha_ingress', authenticated: true};
  f.host.renderScreenSettings();
  assert.equal(click(link), false);
  assert.equal(admin.calls.length, 1);
  for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) assert.equal(click(link, {[key]: true}), true);
  assert.equal(admin.calls.length, 1);
  transport.connected = false;
  assert.equal(click(link), false);
  assert.equal(link.hidden, true);
});

test('standalone admin anchor keeps its native navigation when no HA parent handles the request', async () => {
  const f = await adminFixture(false);
  const snapshot = {bootId: 'b', roomId: 'r', admission: {kind: 'ha_ingress', authenticated: true}};
  f.host.liveSnapshot = snapshot;
  f.host.liveTransport = {connected: true, snapshot, base: ingress('/api/hassio_ingress/abc/view/api/')};
  f.host.renderScreenSettings();
  const event = new MouseEvent('click', {bubbles: true, cancelable: true});
  assert.equal(adminLink(f).dispatchEvent(event), true);
  assert.equal(event.defaultPrevented, false);
  assert.equal(admin.calls.length, 1);
  assert.equal(adminLink(f).getAttribute('href'), ingress('/api/hassio_ingress/abc/').href);
});
