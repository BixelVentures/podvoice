// Added with the move to React. An identical render writes nothing to the DOM; a direct write from outside the
// player (the shell enables Find musik, the controls painter disables the current queue row, radio's progress
// disables the output control) never sticks once the player paints that property again; the regression from
// music-session-queue-state (cleanup cancels the artwork of the queue's placeholder rows) as behaviour; and the
// detail's own markup that root-player-detail-navigation read from index.html, now in the rendered DOM.
import {expect, test} from 'vitest';
import {recordWrites} from '../../test/record-writes.js';
import {mountPlayer, mountSpeakers} from './player-fixture.js';

const vm = {active: true, playing: true, fresh: true, title: 'Soft Light', artist: 'North', target: 'Køkken',
  canOutput: true, examplePosition: true, progressMs: 61000, durationMs: 200000, canSeek: true, trackId: 't1'};
const idle = {active: false, emptyState: 'unconfirmed', canOutput: true, canDiscover: true,
  empty: 'Vælg en stemning eller sang.'};
const rows = [
  {id: '1', title: 'Een', artist: 'A', order: 0, current: true, playing: true, selectable: false},
  {id: '2', title: 'To', artist: 'B', order: 1, selectable: true, revision: 3},
];
const controls = {playing: true, previous: true, next: true, toggle: true, volume: 40, canVolume: true};

function paint(view, model = vm) {
  view.renderPlayer(model);
  view.renderControls(controls);
  view.renderQueue(rows);
}

test('an identical render writes nothing to the DOM', () => {
  // Playing: player, controls and queue. Idle: the empty card (its own pass blocks the controls).
  for (const render of [(view) => paint(view), (view) => view.renderPlayer(idle)]) {
    const {view} = mountPlayer();
    render(view);
    const writes = recordWrites();
    render(view);
    expect([...writes]).toEqual([]);
  }
});

test('an identical speaker sync writes nothing to the DOM', async () => {
  const now = Date.now() / 1000, speaker = (id, name, extra) => ({speakerId: id.repeat(64), accountId: 'account',
    kind: 'configured_alias', nativeRoomId: `r${id}`, homepodId: '42', name, availability: 'available', default: false,
    nativeSelected: false, outputSelected: null, selectable: false, ...extra});
  const {view} = mountSpeakers({
    liveSnapshot: {bootId: 'boot', roomId: 'r0', capabilities: {musicRead: ['targets'], musicSelection: true}},
    liveMedia: {account: 'account'},
    liveTransport: {connected: true, music: async () => ({ok: true, schema: 'podview.speaker-catalogue.v1',
      bootId: 'boot', roomId: 'r0', accountId: 'account', status: 'observed', catalogueId: 'c'.repeat(64),
      retrievedAt: now, source: 'podconnect.get_targets', moveAvailable: false, physicalResultVerified: false,
      speakers: [speaker('a', 'Køkken', {default: true, startSelectable: true}), speaker('b', 'Frida')]})},
  });
  await view.open();
  view.sync();
  const writes = recordWrites();
  view.sync();
  expect([...writes]).toEqual([]);
  view.cleanup();
});

test('direct writes into the player never stick once the player paints them again', () => {
  const {view, $} = mountPlayer();
  view.renderPlayer(idle);
  $('empty-find-music').disabled = true;
  view.renderPlayer(idle);
  expect($('empty-find-music').disabled).toBe(false);
  paint(view);
  view.renderRadioProgress({kind: 'output'});
  expect($('output').disabled).toBe(true);
  view.renderRadioProgress(null);
  view.renderPlayer(vm);
  expect($('output').disabled).toBe(false);
  const current = view.queue.querySelector('.queue-track[data-current="true"]');
  view.renderControls({...controls, toggle: false});
  expect(current.disabled).toBe(true);
  view.renderControls(controls);
  view.renderQueue(rows);
  expect(current.disabled).toBe(false);
  $('queue').hidden = true;
  $('track').disabled = true;
  view.renderQueue(rows);
  view.renderPlayer(vm);
  expect($('queue').hidden).toBe(false);
  expect($('track').disabled).toBe(false);
});

test('a property the player did not paint in this pass keeps a direct write, as before', () => {
  const {view, $} = mountPlayer();
  paint(view);
  $('output').disabled = true;
  view.renderControls(controls);
  view.renderQueue(rows);
  expect($('output').disabled).toBe(true);
});

test('cleanup cancels the artwork of the queue placeholders it owns', () => {
  const {view} = mountPlayer();
  view.renderQueue([], {status: 'loading', placeholders: true});
  expect(view.placeholders).toHaveLength(4);
  const cover = view.placeholders[0].children[1], probe = document.createElement('img');
  const request = {cancelled: false, probe};
  cover.artworkRequest = request;
  view.cleanup();
  expect(cover.artworkRequest).toBe(null);
  expect(request.cancelled).toBe(true);
});

test('the one player detail keeps its heading, queue, seek, volume and output ids', () => {
  mountPlayer();
  const detail = document.getElementById('music-detail'), title = document.getElementById('detail-title');
  expect(title.localName).toBe('h1');
  expect(title.getAttribute('tabindex')).toBe('-1');
  expect(title.textContent).toBe('Afspiller');
  for (const id of ['detail-track', 'queue-title']) expect(document.getElementById(id).localName).toBe('h2');
  for (const id of ['queue', 'player-back', 'detail-progress', 'detail-volume', 'detail-output']) {
    expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
    expect(detail.contains(document.getElementById(id))).toBe(true);
  }
});

test('a revoked room clears the drawn queue at once and the next render draws it again', () => {
  const {view} = mountPlayer();
  paint(view);
  view.renderQueue([], {status: 'loading', placeholders: true});
  view.clearQueue();
  expect(view.queue.children).toHaveLength(0);
  expect(view.rows.size).toBe(0);
  view.renderQueue(rows);
  expect([...view.queue.querySelectorAll('.queue-track')].map(row => row.dataset.trackId)).toEqual(['1', '2']);
  view.renderQueue([rows[1]]);
  expect(view.queue.querySelectorAll('.queue-track')).toHaveLength(1);
});
