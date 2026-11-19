// The connection notice, »Prøv igen« and the topbar's connection labels, ported to Vitest with the real page when the
// shell moved to React: the six host tests of tests/podview/root-connection-presentation.test.mjs (moved here; its
// connectionPresentation model tests stay in node:test). Same assertions. The fake host (renderConnectionNotice and
// renderTopbarClock sliced out of widget-view.js onto stub nodes) is the real host on the real shell; the retry button
// the host created is the shell's (`#screen-device-network>button`); the stub notification queue is the host's own;
// the counted attribute writes are a MutationObserver.
import {afterEach, test, vi} from 'vitest';
import assert from 'node:assert/strict';
import {connectionPresentation} from '../../podvoice-view.js';
import {previewScene} from '../../preview-scenes.js';
import {mountPage, unmountPage} from './shell-fixture.js';

afterEach(unmountPage);

const retryOf = f => f.$('screen-device-network').querySelector(':scope>button');
function count(root) {
  const writes = [];
  const observer = new MutationObserver(records => writes.push(...records));
  observer.observe(root, {subtree: true, attributes: true, childList: true, characterData: true});
  return () => {
    writes.push(...observer.takeRecords());
    return writes.length;
  };
}

test('existing inline retry rereads only, blocks duplicate clicks and restores control after completion', async () => {
  const f = await mountPage('/view/?room=room');
  const {host} = f;
  let finish;
  const calls = [];
  host.liveStatus = 'disconnected';
  host.liveSnapshot = undefined;
  host.liveTransport = {
    restart(...args) {
      calls.push(args);
      return new Promise(resolve => (finish = resolve));
    },
  };
  host.showFeedback = message => {
    host.lastNotification = message;
  };
  host.renderLive = () =>
    host.renderConnectionNotice(connectionPresentation({status: host.liveStatus, snapshot: host.liveSnapshot}));
  host.renderLive();
  const retry = retryOf(f);
  retry.click();
  retry.click();
  assert.deepEqual(calls, [[false, false]]);
  assert.notEqual(retry.disabled, true);
  finish();
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(retry.disabled, false);
  host.liveStatus = 'connected';
  host.liveSnapshot = {capabilities: {homeRead: ['vacuum']}};
  host.renderLive();
  assert.equal(host.lastNotification, '');
  retry.click();
  assert.equal(calls.length, 1);
});

test('connection owner marks all seven retained first-connection cards busy and clears all on resolution', async () => {
  const f = await mountPage('/?stage=now');
  const {host} = f;
  host.showFeedback = message => {
    host.lastNotification = message;
  };
  const cards = [
    ...['timer-card', 'home-weather', 'home-music', 'home-radio', 'home-vehicle'].map(f.$),
    ...[...host.deviceRows.values()].map(row => row.overviewShell || row),
  ];
  assert.equal(cards.length, 7);
  host.renderConnectionNotice(connectionPresentation({status: 'connecting'}));
  for (const card of cards) assert.equal(card.getAttribute('aria-busy'), 'true');
  host.renderConnectionNotice(connectionPresentation({status: 'connected'}));
  for (const card of cards) assert.equal(card.getAttribute('aria-busy'), 'false');
  assert.equal(host.lastNotification, '');
});

test('conversation reconnecting and disconnected project distinct persistent labels through the actual topbar without restoring control', async () => {
  for (const [stage, label, state] of [
    ['conversation-reconnecting', 'Genopretter forbindelse…', 'connecting'],
    ['conversation-offline', 'Forbindelsen er afbrudt', 'offline'],
  ]) {
    const f = await mountPage(`/?stage=${stage}`);
    const scene = previewScene(stage);
    f.host.state = scene;
    const before = JSON.stringify(scene);
    f.host.renderTopbarClock(new Date('2026-10-23T10:00:00Z'));
    assert.equal(f.$('header-date').textContent, label);
    assert.equal(f.$('photo-date').textContent, label);
    assert.equal(connectionPresentation(scene.connectionPreview).state, state);
    assert.equal(scene.connected, false);
    assert.equal(JSON.stringify(scene), before);
    assert.equal(scene.music.pending, null);
    assert.ok(scene.answers.length);
    assert.ok(scene.timer);
    unmountPage();
  }
  const f = await mountPage('/view/?room=room');
  const live = f.host;
  Object.assign(live, {liveStatus: 'connecting', liveSnapshot: {}});
  live.state = {...live.state, connected: false};
  live.renderTopbarClock(new Date());
  assert.equal(f.$('header-date').textContent, 'Genopretter forbindelse…');
  live.liveStatus = 'disconnected';
  live.renderTopbarClock(new Date());
  assert.equal(f.$('header-date').textContent, 'Forbindelsen er afbrudt');
  live.browserOffline = true;
  live.renderTopbarClock(new Date());
  assert.equal(f.$('header-date').textContent, 'Ingen netværksforbindelse');
  assert.equal(f.$('photo-date').textContent, 'Ingen netværksforbindelse');
  live.browserOffline = false;
  live.liveStatus = 'connected';
  live.renderTopbarClock(new Date('2026-10-23T10:00:00Z'));
  assert.notEqual(f.$('photo-date').textContent, 'Ingen netværksforbindelse');
});

test('persistent connection uses existing status and retry without replacing an action receipt', async () => {
  const f = await mountPage('/?stage=now');
  const {host} = f;
  host.state = {...host.state, connectionPreview: null};
  host.showFeedback('Handling modtaget', false, {source: 'action'});
  const q = host.notifications;
  host.renderConnectionNotice(connectionPresentation({status: 'disconnected', snapshot: {}}));
  assert.equal(q.current.source, 'action');
  const retry = retryOf(f);
  assert.equal(f.$('screen-device-network').lastElementChild, retry);
  assert.equal(retry.hidden, false);
  f.$('quick-sheet').showModal();
  retry.focus();
  host.renderConnectionNotice(
    connectionPresentation({status: 'connected', snapshot: {capabilities: {homeRead: ['vacuum']}}}),
  );
  assert.equal(retry.hidden, true);
  assert.equal(document.activeElement, f.$('screen-device-more-summary'));
  assert.equal(q.current.source, 'action');
  q.dismiss();
  assert.equal(q.current, null);
  host.renderConnectionNotice(
    connectionPresentation({
      status: 'connected',
      snapshot: {capabilities: {homeRead: [], musicRead: [], timerActions: [], answerRead: false}},
    }),
  );
  assert.equal(q.current.source, 'connection');
  assert.match(q.current.message, /Intet indhold/);
});

test('identical connection clock renders never rewrite status or description attributes', async () => {
  const f = await mountPage('/view/?room=room');
  const {host} = f,
    time = new Date('2026-10-23T10:00:00Z');
  Object.assign(host, {liveStatus: 'disconnected', liveSnapshot: {}});
  vi.spyOn(host.motion, 'value').mockImplementation((node, text) => {
    if (node.textContent !== text) node.textContent = text;
  });
  const watched = [document.querySelector('.view-nav'), f.$('photo-date')];
  let writes = watched.map(count);
  host.renderTopbarClock(time);
  assert.ok(writes.reduce((sum, read) => sum + read(), 0) > 0);
  writes = watched.map(count);
  host.renderTopbarClock(time);
  assert.equal(
    writes.reduce((sum, read) => sum + read(), 0),
    0,
  );
  host.liveStatus = 'connected';
  host.liveSnapshot = {capabilities: {homeRead: ['vacuum']}};
  host.renderTopbarClock(time);
  writes = watched.map(count);
  host.renderTopbarClock(time);
  assert.equal(
    writes.reduce((sum, read) => sum + read(), 0),
    0,
  );
});

test('retry remains visible, busy and focused during connecting, then hides safely on recovery', async () => {
  const f = await mountPage('/?stage=now');
  const {host} = f,
    retry = retryOf(f);
  host.showFeedback = () => {};
  host.connectionRetryPending = true;
  f.$('quick-sheet').showModal();
  host.renderConnectionNotice(connectionPresentation({status: 'connecting', snapshot: {}}));
  retry.focus();
  assert.equal(retry.hidden, false);
  assert.equal(retry.disabled, false);
  assert.equal(retry.getAttribute('aria-disabled'), 'true');
  assert.equal(retry.getAttribute('aria-busy'), 'true');
  assert.equal(document.activeElement, retry);
  const writes = count(retry);
  host.renderConnectionNotice(connectionPresentation({status: 'connecting', snapshot: {}}));
  assert.equal(writes(), 0);
  host.connectionRetryPending = false;
  host.renderConnectionNotice(
    connectionPresentation({status: 'connected', snapshot: {capabilities: {homeRead: ['vacuum']}}}),
  );
  assert.equal(retry.hidden, true);
  assert.equal(retry.disabled, false);
  assert.equal(retry.getAttribute('aria-disabled'), 'false');
  assert.equal(retry.getAttribute('aria-busy'), 'false');
  assert.equal(document.activeElement, f.$('screen-device-more-summary'));
});
