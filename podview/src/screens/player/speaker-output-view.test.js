// Ported from tests/podview/root-speaker-output-view.test.mjs (node:test with a minimal fake DOM) to Vitest with a
// real DOM (happy-dom) when the speaker picker moved to React. Same assertions; each port was first run against the
// old speaker-output-view.js in the same real DOM. Adaptations for the real
// DOM: the fake surface became the real shell (mountSpeakers), the dialog's note is its <p>; the fake child arrays
// became [...children], compared node by node (sameNodes); fake `attributes['aria-busy']` became getAttribute; the
// fake `row.listeners.click()` became a real click (click(row)), and where the test awaited the listener's promise
// it now waits for the click's work to settle (settle()); the fake `rooms.open=true` is the real dialog's open, and
// the fake `rooms.open=false; rooms.listeners.close()` is the real dialog's close(), which fires the same close
// event; the fake `ownerDocument.createElement` overrides that let rows install listeners became
// surface({actions: true}). The fake threw when a read-only row installed a click listener; the same guarantee is
// kept by a guard on addEventListener that throws for a click listener on a row of #room-options unless the test
// allows actions. The pure catalogue tests stay pure.
import assert from 'node:assert/strict';
import {beforeEach, test, vi} from 'vitest';
import {PodVoiceTransport} from '../../../podvoice-transport.js';
import {playbackBinding, roomPlayerObservation} from '../../../media-observation.js';
import {roomPlayerWire} from '../../../../scripts/room-player-wire.mjs';
import {click, mountSpeakers} from './player-fixture.js';
import {speakerCatalogue} from './SpeakerOutputView';


// Authored scenes in the room player's wire shape (podview.room-player.v1).
const roomPlaybackObservation = (body, account, snapshot) =>
  roomPlayerObservation(roomPlayerWire(body), account, snapshot);
const context = {bootId: 'boot', roomId: 'r0', accountId: 'account'};
function payload() {
  return {
    ok: true, schema: 'podview.speaker-catalogue.v1', ...context, status: 'observed', catalogueId: 'c'.repeat(64),
    retrievedAt: Date.now() / 1000, source: 'podconnect.get_targets',
    speakers: [
      {speakerId: 'a'.repeat(64), accountId: 'account', kind: 'configured_alias', nativeRoomId: 'r0', homepodId: '42',
        name: 'Køkkenalrum HomePod', availability: 'available', default: true, nativeSelected: true,
        outputSelected: true, selectable: false},
      {speakerId: 'b'.repeat(64), accountId: 'account', kind: 'configured_alias', nativeRoomId: 'r1', homepodId: '43',
        name: 'Soveværelse', availability: 'unknown', default: false, nativeSelected: false, outputSelected: null,
        selectable: false},
    ],
    moveAvailable: false, physicalResultVerified: false,
  };
}

// The real tests' timers stay usable while a test replaces globalThis.setTimeout.
const realSetTimeout = globalThis.setTimeout;
// The work a click started (its awaited reads and the row it clicks next) has settled.
const settle = () => new Promise(resolve => realSetTimeout(resolve, 0));
// Node identity, one by one (a deep compare of two distinct DOM nodes proves nothing).
function sameNodes(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((node, index) => assert.equal(node, expected[index]));
}

// Read-only rows must never install actions (the fake DOM threw here): while a test's surface is read-only, a click
// listener added to a row of #room-options throws.
let readOnlyRows = false;
beforeEach(() => {
  readOnlyRows = false;
  let proto = HTMLButtonElement.prototype;
  while (!Object.hasOwn(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto);
  const add = proto.addEventListener;
  vi.spyOn(proto, 'addEventListener').mockImplementation(function (kind, fn, options) {
    if (readOnlyRows && kind === 'click' && this.parentNode?.id === 'room-options')
      throw Error('read-only rows must never install actions');
    return add.call(this, kind, fn, options);
  });
});

function surface({actions = false} = {}) {
  const {host, view, $} = mountSpeakers({
    liveSnapshot: {bootId: 'boot', roomId: 'r0', capabilities: {musicRead: ['targets']}},
    liveMedia: {account: 'account'},
    liveTransport: {connected: true, music: async () => payload()},
  });
  readOnlyRows = !actions;
  const ids = {'room-options': $('room-options'), rooms: $('rooms')};
  return {host, view, ids, note: ids.rooms.querySelector('p')};
}
const rowsOf = f => [...f.ids['room-options'].children];

test('sorts real possessive HomePod names without changing identities or fallback order', () => {
  const data = payload(), base = data.speakers[1];
  data.speakers = [['Frida’s HomePod', 'c', 'r2'], ['Svend’s HomePod', 'd', 'r3'], ['Køkkenalrum', 'a', 'r0'],
    ['Zulu', 'e', 'r4'], ['Alfa', 'f', 'r5']]
    .map(([name, id, room]) => ({...base, name, speakerId: id.repeat(64), nativeRoomId: room, homepodId: null}));
  const rows = speakerCatalogue(data, context);
  assert.deepEqual(rows.map(row => row.name), ['Køkkenalrum', 'Svend’s HomePod', 'Frida’s HomePod', 'Alfa', 'Zulu']);
  assert.deepEqual(rows.map(row => row.speakerId), ['a', 'd', 'c', 'f', 'e'].map(id => id.repeat(64)));
  data.speakers[0].name = "Frida's HomePod";
  data.speakers[1].name = "Svend's HomePod";
  assert.deepEqual(speakerCatalogue(data, context).slice(0, 3).map(row => row.name),
    ['Køkkenalrum', "Svend's HomePod", "Frida's HomePod"]);
});

test('closed native read model retains current names and unknown state without writable authority', () => {
  const value = payload();
  assert.deepEqual(speakerCatalogue(value, context), value.speakers);
  assert.equal(value.speakers[1].availability, 'unknown');
});

for (const change of ['account', 'room', 'boot', 'expired', 'future', 'extra', 'writable', 'spotify', 'duplicate',
  'homepod', 'badflag', 'empty'])
  test(`speaker model denies ${change}`, () => {
    const v = payload();
    if (change === 'account') v.accountId = 'other';
    if (change === 'room') v.roomId = 'bedroom';
    if (change === 'boot') v.bootId = 'other';
    if (change === 'expired') v.retrievedAt -= 31;
    if (change === 'future') v.retrievedAt += 6;
    if (change === 'extra') v.authorized = true;
    if (change === 'writable') v.moveAvailable = 'true';
    if (change === 'spotify') v.speakers[0].kind = 'spotify_device';
    if (change === 'duplicate') v.speakers[1].speakerId = v.speakers[0].speakerId;
    if (change === 'homepod') v.speakers[0].homepodId = '042';
    if (change === 'badflag') v.speakers[0].selectable = 1;
    if (change === 'empty') v.speakers = [];
    assert.equal(speakerCatalogue(v, context), null);
  });

test('actual canonical sheet receives only text names and disabled stable-ID rows, one passive read', async () => {
  const f = surface(), {host, view} = f, calls = [];
  host.liveTransport.music = async (...args) => {
    calls.push(args);
    const v = payload();
    v.speakers[1].name = '<img src=x onerror=alert(1)>';
    return v;
  };
  await view.open();
  assert.deepEqual(calls, [['speakers', 'account']]);
  assert.equal(rowsOf(f).length, 2);
  const [first, second] = rowsOf(f);
  assert.equal(first.disabled, true);
  assert.equal(second.disabled, true);
  assert.equal(first.dataset.speakerId, 'a'.repeat(64));
  assert.equal(second.children[1].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(second.children[1].children[1].textContent, 'Status ukendt');
  assert.equal(first.children[2].textContent, 'Standardrum');
  assert.equal(first.getAttribute('aria-pressed'), 'false');
  assert.match(f.note.textContent, /rumskift er endnu ikke tilgængeligt/);
  view.cleanup();
});

for (const change of ['account', 'room', 'boot', 'capability', 'transport', 'disconnect', 'cleanup'])
  test(`held catalogue cannot publish after ${change}`, async () => {
    const f = surface(), {host, view, ids} = f;
    let resolve;
    host.liveTransport.music = () => new Promise(r => resolve = r);
    const opening = view.open();
    assert.equal(ids['room-options'].getAttribute('aria-busy'), 'true');
    if (change === 'account') host.liveMedia.account = 'other';
    if (change === 'room') host.liveSnapshot.roomId = 'other';
    if (change === 'boot') host.liveSnapshot.bootId = 'other';
    if (change === 'capability') host.liveSnapshot.capabilities.musicRead = [];
    if (change === 'transport') host.liveTransport = {...host.liveTransport};
    if (change === 'disconnect') host.liveTransport.connected = false;
    if (change === 'cleanup') view.cleanup();
    resolve(payload());
    await opening;
    assert.equal(rowsOf(f).length, 0);
    assert.equal(ids['room-options'].getAttribute('aria-busy'), 'false');
    view.cleanup();
  });

test('read error retains disabled previous catalogue and offers refresh without a move', async () => {
  const f = surface(), {host, view} = f;
  await view.open();
  host.liveTransport.music = async () => { throw Error('unavailable'); };
  await view.open();
  assert.equal(rowsOf(f).length, 2);
  assert(rowsOf(f).every(row => row.disabled));
  assert.match(f.note.textContent, /kunne ikke opdateres/);
  view.cleanup();
});

test('scope sync removes prior displayed catalogue when actual account changes', async () => {
  const f = surface(), {host, view} = f;
  await view.open();
  host.liveMedia.account = 'other';
  view.sync();
  assert.equal(rowsOf(f).length, 0);
  view.cleanup();
});

test('actual transport uses existing targets read permission for speakers and never POSTs effects', async () => {
  const calls = [];
  const transport = new PodVoiceTransport({url: 'http://local/view/', room: 'r0', fetch: async (url, init) => {
    calls.push([url, init]);
    return {ok: true, json: async () => payload()};
  }});
  transport.connected = true;
  transport.closed = false;
  transport.controller = new AbortController();
  transport.snapshot = {capabilities: {musicRead: ['targets']}};
  await transport.music('speakers', 'account');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].searchParams.get('kind'), 'speakers');
  assert.equal(calls[0][0].searchParams.get('room'), 'r0');
  assert.equal(calls[0][1].method, undefined);
  transport.snapshot.capabilities.musicRead = [];
  await assert.rejects(transport.music('speakers', 'account'));
  assert.equal(calls.length, 1);
});

test('queued old expiry cannot clear a newer catalogue', async () => {
  const original = globalThis.setTimeout, callbacks = [];
  globalThis.setTimeout = fn => { callbacks.push(fn); return callbacks.length; };
  const f = surface(), {view} = f;
  try {
    await view.open();
    const first = callbacks[0];
    await view.open();
    assert.equal(rowsOf(f).length, 2);
    first();
    assert.equal(rowsOf(f).length, 2);
    callbacks.at(-1)();
    assert.equal(rowsOf(f).length, 2);
    assert(rowsOf(f).every(row => row.disabled));
  } finally {
    view.cleanup();
    globalThis.setTimeout = original;
  }
});

test('same fresh catalogue remains during quiet read; changed context clears immediately', async () => {
  const f = surface(), {host, view, ids} = f;
  await view.open();
  const rows = rowsOf(f);
  let resolve;
  host.liveTransport.music = () => new Promise(r => resolve = r);
  const reading = view.open();
  sameNodes(rowsOf(f), rows);
  assert.doesNotMatch(f.note.textContent, /Henter aktuelle højttalere/);
  assert.equal(ids['room-options'].getAttribute('aria-busy'), 'false');
  resolve(payload());
  await reading;
  host.liveMedia.account = 'other';
  const changed = view.open();
  assert.equal(rowsOf(f).length, 0);
  assert.equal(f.note.textContent, '');
  resolve({...payload(), accountId: 'other'});
  await changed;
  view.cleanup();
});

test('strict true catalogue hints permit only setup requests; no current grant means disabled rows', async () => {
  const f = surface({actions: true}), {host, view} = f;
  host.liveTransport.music = async () => {
    const v = payload();
    v.moveAvailable = true;
    v.speakers[1] = {...v.speakers[1], availability: 'available', outputSelected: false, selectable: true};
    return v;
  };
  await view.open();
  assert.equal(rowsOf(f)[1].disabled, true);
  view.cleanup();
});

test('enabled alias row uses exact stored ID and current catalogue callback with no local room mutation',
  async () => {
    const f = surface({actions: true}), {host, view} = f;
    let calls = [];
    const music = {key: 'music', target: {targetId: 'engine'}};
    host.liveControls = {musicContext: () => music,
      moveSpeaker: (row, current) => calls.push([row.speakerId, current()])};
    host.liveTransport.music = async () => {
      const v = payload();
      v.moveAvailable = true;
      v.speakers[1] = {...v.speakers[1], availability: 'available', outputSelected: false, selectable: true};
      return v;
    };
    await view.open();
    const b = rowsOf(f)[1];
    assert.equal(b.disabled, false);
    click(b);
    assert.deepEqual(calls, [['b'.repeat(64), true]]);
    assert.equal(host.liveSnapshot.roomId, 'r0');
    host.liveControls.pending = true;
    host.liveControls.activeOperation = {domain: 'music'};
    view.sync();
    assert.equal(b.disabled, true);
    click(b);
    assert.equal(calls.length, 1);
    host.liveControls.pending = false;
    host.liveControls.activeOperation = null;
    // An unknown earlier outcome never holds the next explicit choice (Green 13/11 11:41).
    host.liveControls.musicFence = {key: 'music', outcome: 'unknown'};
    view.sync();
    assert.equal(b.disabled, false);
    click(b);
    assert.equal(calls.length, 2);
    view.cleanup();
  });

test('passive control refresh retains valid MOVE choices and explains missing confirmed playback', async () => {
  const f = surface({actions: true}), {host, view} = f;
  let music = {key: 'music'};
  host.liveControls = {musicContext: () => music, musicReadPending: true};
  host.liveTransport.music = async () => {
    const v = payload();
    v.moveAvailable = true;
    v.speakers[1] = {...v.speakers[1], availability: 'available', outputSelected: false, selectable: true};
    return v;
  };
  actualPlayback({host}, {nativeRoomId: 'r0', nativeHomepodId: '42'});
  try {
    await view.open();
    const rows = rowsOf(f);
    assert.equal(rows[0].disabled, false, 'the current output is never locked (Green 13/11)');
    assert.equal(rows[1].disabled, false);
    assert.match(f.note.textContent, /aktuelle afspilning/);
    music = null;
    view.sync();
    assert.equal(rows[1].disabled, true);
    assert.match(f.note.textContent, /skal bekræftes/);
    assert.equal(rows[0].children[2].textContent, 'Aktuelt output');
    music = {key: 'music'};
    host.liveControls.musicFence = {key: 'music', outcome: 'unknown'};
    view.sync();
    assert.equal(rows[1].disabled, false, 'an unknown outcome never greys a speaker');
    assert.doesNotMatch(f.note.textContent, /ukendt/);
    host.liveControls.musicFence = null;
    view.validUntil = Date.now() - 1;
    view.sync();
    assert.equal(rows[1].disabled, false);
  } finally {
    view.cleanup();
  }
});

function idleStartSurface() {
  const f = surface({actions: true}), calls = [];
  f.host.liveSnapshot.capabilities.musicSelection = true;
  f.host.liveControls = {musicContext: () => null, moveSpeaker: () => calls.push('MOVE'),
    musicFence: {outcome: 'unknown'}};
  f.host.liveSelection = {pending: false, feedback: {outcome: 'unknown', message: 'Unknown'}};
  f.host.liveTransport.music = async () => {
    calls.push('read');
    const p = payload();
    for (const row of p.speakers) Object.assign(row, {availability: 'available', startSelectable: true});
    return p;
  };
  return {...f, calls};
}

test('idle destination choice is nonexecuting scoped intent, not MOVE, playback or binding mutation', async () => {
  const f = idleStartSurface();
  try {
    const before = JSON.stringify(f.host.liveSnapshot), feedback = f.host.liveSelection.feedback;
    await f.view.open();
    const row = rowsOf(f)[1];
    assert.equal(row.disabled, false);
    assert.equal(f.note.textContent, '');
    click(row);
    assert.deepEqual(f.view.selectionDestination(), {speakerId: 'b'.repeat(64), name: 'Soveværelse'});
    assert.equal(row.children[2].textContent, 'Valgt');
    assert.equal(JSON.stringify(f.host.liveSnapshot), before);
    assert.equal(f.host.liveMedia.playback, undefined);
    assert.equal(f.host.liveSelection.feedback, feedback);
    assert.deepEqual(f.calls, ['read']);
  } finally {
    f.view.cleanup();
  }
});

for (const change of ['account', 'room', 'boot', 'grant', 'pending'])
  test(`idle destination intent never survives ${change} as executable authority`, async () => {
    const f = idleStartSurface();
    try {
      await f.view.open();
      const row = rowsOf(f)[1];
      if (change === 'pending') {
        f.host.liveControls.pending = true;
        f.host.liveControls.activeOperation = {domain: 'music'};
        f.view.sync();
        click(row);
        assert.equal(f.view.nextDestination ?? null, null);
        assert.deepEqual(f.calls, ['read']);
        return;
      }
      click(row);
      if (change === 'account') f.host.liveMedia.account = 'other';
      if (change === 'room') f.host.liveSnapshot.roomId = 'other';
      if (change === 'boot') f.host.liveSnapshot.bootId = 'other';
      if (change === 'grant') f.host.liveSnapshot.capabilities.musicSelection = false;
      assert.throws(() => f.view.selectionDestination());
      assert.deepEqual(f.calls, ['read']);
    } finally {
      f.view.cleanup();
    }
  });

test('startSelectable is an explicit optional boolean, never inferred from MOVE-selectable or availability',
  async () => {
    for (const value of [1, 'true', null]) {
      const p = payload();
      p.speakers[0].startSelectable = value;
      assert.equal(speakerCatalogue(p, context), null);
    }
    const f = idleStartSurface();
    try {
      f.host.liveTransport.music = async () => {
        const p = payload();
        p.moveAvailable = true;
        p.speakers[1] = {...p.speakers[1], availability: 'available', selectable: true};
        return p;
      };
      await f.view.open();
      assert.equal(rowsOf(f)[1].disabled, true);
      assert.equal(f.view.selectionDestination(), null);
    } finally {
      f.view.cleanup();
    }
  });

test('confirmed desired output is matched by opaque identity and exact native pair, not name', () => {
  const f = idleStartSurface();
  try {
    const rows = payload();
    rows.speakers[1].name = rows.speakers[0].name;
    f.host.liveSnapshot.mediaRoomBindings = [{accountId: 'account', bindingId: 'a'.repeat(64), roomId: 'r0',
      targetId: 'engine', nativeRoomId: 'r0', nativeHomepodId: '42'}];
    actualPlayback(f, {nativeRoomId: 'r0', nativeHomepodId: '42'});
    f.view.labelScope = f.view.context();
    f.view.labelValue = rows;
    assert.equal(f.view.observedDestination('b'.repeat(64)), false);
    assert.equal(f.view.observedDestination('a'.repeat(64)), true);
  } finally {
    f.view.cleanup();
  }
});

test('remembered nonexecuting preference survives catalogue expiry or changed hints; fresh server setup still owns '
  + 'admission', async () => {
  const f = idleStartSurface();
  try {
    await f.view.open();
    click(rowsOf(f)[1]);
    const remembered = f.view.nextDestination;
    f.host.liveTransport.music = async () => {
      const p = payload();
      for (const row of p.speakers) Object.assign(row, {availability: 'available', startSelectable: false});
      return p;
    };
    await f.view.open();
    assert.equal(f.view.nextDestination, remembered);
    assert.deepEqual(f.view.selectionDestination(), {speakerId: 'b'.repeat(64), name: 'Soveværelse'});
    f.view.validUntil = Date.now() - 1;
    assert.deepEqual(f.view.selectionDestination(), {speakerId: 'b'.repeat(64), name: 'Soveværelse'});
    assert.equal(rowsOf(f)[1].disabled, true);
    assert.deepEqual(f.calls, ['read']);
  } finally {
    f.view.cleanup();
  }
});

test('expired catalogue cannot accept a new choice, but existing desired output is not a timed grant', async () => {
  const f = idleStartSurface();
  try {
    await f.view.open();
    const row = rowsOf(f)[1];
    click(row);
    const desired = f.view.nextDestination;
    f.view.validUntil = Date.now() - 1;
    click(row);
    assert.equal(row.disabled, false);
    assert.equal(f.view.nextDestination, desired);
    assert.deepEqual(f.view.selectionDestination(), {speakerId: 'b'.repeat(64), name: 'Soveværelse'});
    await f.view.open();
    assert.equal(f.view.nextDestination, desired);
    assert.deepEqual(f.calls, ['read', 'read']);
  } finally {
    f.view.cleanup();
  }
});

test('whole-row selection announces chosen destination separately from observed output', async () => {
  const f = surface(), {host, view} = f;
  try {
    actualPlayback({host}, {nativeRoomId: 'r0', nativeHomepodId: '42'});
    await view.open();
    const [current, requested] = rowsOf(f);
    assert.equal(current.getAttribute('aria-pressed'), 'true');
    assert.match(current.getAttribute('aria-label'), /Aktuelt output/);
    assert.doesNotMatch(current.getAttribute('aria-label'), /Valgt/);
    assert.equal(current.disabled, true);
    assert.equal(requested.getAttribute('aria-pressed'), 'false');
    view.nextDestination = {speakerId: requested.speakerRow.speakerId, name: requested.speakerRow.name};
    host.liveSelection = {pending: true};
    view.sync();
    assert.equal(current.getAttribute('aria-pressed'), 'false');
    assert.equal(requested.getAttribute('aria-pressed'), 'true');
    assert.match(current.getAttribute('aria-label'), /Aktuelt output/);
    assert.equal(requested.children[2].textContent, 'Valgt');
    assert.equal(requested.disabled, true);
    current.speakerRow.nativeSelected = false;
    current.speakerRow.outputSelected = false;
    requested.speakerRow.nativeSelected = true;
    requested.speakerRow.outputSelected = true;
    view.sync();
    assert.equal(current.getAttribute('aria-pressed'), 'false');
    assert.equal(requested.getAttribute('aria-pressed'), 'true');
    actualPlayback({host});
    view.sync();
    assert.equal(current.speakerRow.default, true);
    assert.equal(current.getAttribute('aria-pressed'), 'false');
    assert.equal(requested.getAttribute('aria-pressed'), 'true');
    view.validUntil = Date.now() - 1;
    view.sync();
    assert.equal(current.getAttribute('aria-pressed'), 'false');
    assert.equal(requested.getAttribute('aria-pressed'), 'true');
  } finally {
    view.cleanup();
  }
});

function configuredSurface() {
  const f = surface();
  f.host.liveSnapshot.mediaRoomBindings = [{accountId: 'account', bindingId: 'a'.repeat(64), roomId: 'r0',
    targetId: 'engine', nativeRoomId: 'r0', nativeHomepodId: '42'}];
  return f;
}
function actualPlayback(f, {nativeRoomId = 'r1', nativeHomepodId = '43', idle = false, version = 2} = {}) {
  f.host.liveSnapshot.capabilities.musicRead = ['targets', 'playback'];
  const p = {
    ok: true, schema: 'podview.room-playback.v2', bootId: 'boot', roomId: 'r0', configEntryId: 'account',
    status: 'observed', reason: null,
    binding: {accountId: 'account', roomId: 'r0', targetId: 'actual-engine', nativeRoomId, nativeHomepodId,
      bindingId: 'f'.repeat(64), validUntil: Date.now() / 1000 + 15},
    data: {
      ok: true, schema: 'podconnect.playback.v1', config_entry_id: 'account', owner_epoch: 'native-owner',
      poll_sequence: 1,
      observation: {status: 'fresh', source: 'spotify_web_api', observed_at: new Date().toISOString(), age_ms: 0,
        max_age_ms: 15000},
      playback: {state: 'playing',
        target: {kind: 'spotify_device', target_id: 'actual-engine', name: 'Provider target'},
        item: {type: 'track', uri: 'spotify:track:' + 'A'.repeat(22), name: 'Actual track', artists: ['Actual artist'],
          duration_ms: 180000},
        progress_ms: 1000, provider_changed_at_ms: Date.now(), shuffle: false, repeat: 'off'},
      physical_result_verified: false,
    },
  };
  if (idle) {
    p.status = 'idle';
    p.binding = null;
    p.data.playback = {state: 'no_active_playback', target: null, item: null};
  }
  if (version === 3) {
    p.schema = 'podview.room-playback.v3';
    p.binding.validUntil = Date.now() / 1000 + 4;
    p.controls = {status: 'observed', reason: 'volume_unavailable', binding_id: p.binding.bindingId,
      valid_until: p.binding.validUntil, supported_actions: ['pause'], volume: null};
    p.permissions = {actions: ['pause'], maxVolume: null};
  }
  f.host.liveMedia.playback = roomPlaybackObservation(p, 'account', f.host.liveSnapshot);
  return playbackBinding(f.host.liveMedia.playback, f.host.liveSnapshot, 'account');
}

test('configured display name survives actual catalogue TTL, pending refresh and transient error without retaining '
  + 'observed destination authority', async () => {
  const originalNow = Date.now, originalTimeout = globalThis.setTimeout, callbacks = [], calls = [];
  let now = originalNow();
  Date.now = () => now;
  globalThis.setTimeout = fn => { callbacks.push(fn); return callbacks.length; };
  const f = configuredSurface();
  try {
    actualPlayback(f, {nativeRoomId: 'r0', nativeHomepodId: '42'});
    f.host.liveTransport.music = async (...args) => { calls.push(args); return payload(); };
    await f.view.refreshConfiguredLabel();
    assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
    assert.equal(f.view.observedDestination('a'.repeat(64)), true);
    now += 30001;
    callbacks[0]();
    assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
    assert.equal(f.view.observedDestination('a'.repeat(64)), false);
    let reject;
    f.host.liveTransport.music = (...args) => { calls.push(args); return new Promise((_, r) => reject = r); };
    const pending = f.view.refreshConfiguredLabel();
    assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
    reject(Error('network unavailable'));
    await pending;
    assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
    assert.equal(f.view.observedDestination('a'.repeat(64)), false);
    assert.deepEqual(calls, [['speakers', 'account'], ['speakers', 'account']]);
    assert.equal(f.view.selectionDestination(), null);
  } finally {
    f.view.cleanup();
    Date.now = originalNow;
    globalThis.setTimeout = originalTimeout;
  }
});

for (const change of ['account', 'room', 'boot', 'nativeRoom', 'nativeHomepod', 'binding', 'transport', 'readAccess',
  'disconnect'])
  test(`configured display custody is cleared on ${change} and cannot revive without fresh validation`, async () => {
    const f = configuredSurface();
    try {
      await f.view.refreshConfiguredLabel();
      assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
      const original = f.host.liveSnapshot, transport = f.host.liveTransport, account = f.host.liveMedia.account;
      f.host.liveSnapshot = structuredClone(original);
      if (change === 'account') f.host.liveMedia.account = 'other';
      if (change === 'room') f.host.liveSnapshot.roomId = 'other';
      if (change === 'boot') f.host.liveSnapshot.bootId = 'other';
      if (change === 'nativeRoom') f.host.liveSnapshot.mediaRoomBindings[0].nativeRoomId = 'other';
      if (change === 'nativeHomepod') f.host.liveSnapshot.mediaRoomBindings[0].nativeHomepodId = '43';
      if (change === 'binding') f.host.liveSnapshot.mediaRoomBindings = [];
      if (change === 'transport') f.host.liveTransport = {...transport};
      if (change === 'readAccess') f.host.liveSnapshot.capabilities.musicRead = [];
      if (change === 'disconnect') f.host.liveTransport = {...transport, connected: false};
      assert.equal(f.view.configuredLabel(), '');
      f.host.liveSnapshot = original;
      f.host.liveTransport = transport;
      f.host.liveMedia.account = account;
      assert.equal(f.view.configuredLabel(), '');
    } finally {
      f.view.cleanup();
    }
  });

test('same binding revisions preserve configured display while malformed or denied refresh clears it', async () => {
  const f = configuredSurface();
  try {
    await f.view.refreshConfiguredLabel();
    f.host.liveSnapshot.inputRevision = 2;
    f.view.sync();
    assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
    f.host.liveTransport.music = async () => ({...payload(), ok: false});
    f.view.labelRetryAt = 0;
    await f.view.refreshConfiguredLabel();
    assert.equal(f.view.configuredLabel(), '');
    assert.equal(f.view.labelValue, null);
  } finally {
    f.view.cleanup();
  }
});

test('explicit read denial clears remembered configured name rather than treating it as transient', async () => {
  const f = configuredSurface();
  try {
    await f.view.refreshConfiguredLabel();
    assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
    f.view.labelRetryAt = 0;
    f.host.liveTransport.music = async () => {
      throw Object.assign(Error('forbidden'), {code: 'read_access_denied'});
    };
    await f.view.refreshConfiguredLabel();
    assert.equal(f.view.configuredLabel(), '');
    assert.equal(f.view.observedDestination('a'.repeat(64)), false);
  } finally {
    f.view.cleanup();
  }
});

test('available discovery without start or move capability explains disabled destination without claiming offline',
  async () => {
    const f = surface();
    f.host.liveSnapshot.capabilities.musicSelection = true;
    f.host.liveTransport.music = async () => {
      const p = payload();
      p.speakers[1] = {...p.speakers[1], availability: 'available', startSelectable: false, selectable: false};
      return p;
    };
    try {
      await f.view.open();
      const row = rowsOf(f)[1];
      assert.equal(row.disabled, true);
      assert.equal(row.children[1].children[1].textContent, 'Kan ikke vælges til afspilning');
      assert.equal(row.children[2].textContent, '');
    } finally {
      f.view.cleanup();
    }
  });

test('next destination pressed state remains separate from observed output', async () => {
  const f = idleStartSurface();
  try {
    actualPlayback(f, {nativeRoomId: 'r0', nativeHomepodId: '42'});
    await f.view.open();
    const [actual, next] = rowsOf(f);
    click(next);
    assert.equal(actual.children[2].textContent, 'Aktuelt output');
    assert.equal(next.children[2].textContent, 'Valgt');
    assert.match(next.getAttribute('aria-label'), /Valgt/);
    assert.match(actual.getAttribute('aria-label'), /Aktuelt output/);
    assert.equal(actual.getAttribute('aria-pressed'), 'false');
    assert.equal(next.getAttribute('aria-pressed'), 'true');
    click(actual);
    assert.equal(actual.children[2].textContent, 'Valgt');
    assert.equal(actual.getAttribute('aria-pressed'), 'true');
    assert.equal(next.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(f.calls, ['read']);
  } finally {
    f.view.cleanup();
  }
});

test('existing row reason updates with pending and unknown action fences', async () => {
  const f = idleStartSurface();
  try {
    await f.view.open();
    const row = rowsOf(f)[1], detail = row.children[1].children[1];
    assert.equal(detail.textContent, '');
    f.host.liveSelection.pending = true;
    f.view.sync();
    assert.equal(row.disabled, false, 'a music search never locks the speakers');
    f.host.liveSelection.pending = false;
    f.host.liveControls.pending = true;
    f.host.liveControls.activeOperation = {domain: 'vacuum'};
    f.view.sync();
    assert.equal(row.disabled, false, 'a robot action never locks the speakers');
    f.host.liveControls.activeOperation = {domain: 'music'};
    f.view.sync();
    assert.equal(row.disabled, true);
    assert.equal(detail.textContent, 'Musikhandlingen behandles');
    f.host.liveControls.pending = false;
    f.host.liveControls.activeOperation = null;
    f.host.liveControls.musicContext = () => ({key: 'current'});
    f.host.liveControls.musicFence = {key: 'current', outcome: 'unknown'};
    f.view.sync();
    assert.notEqual(detail.textContent, 'Sidste musikhandling har ukendt udfald',
      'an unknown outcome is not a lock on other speakers');
    assert.equal(row.children[1].children[1], detail);
  } finally {
    f.view.cleanup();
  }
});

test('expiry retains disabled rows; explicit refresh is single-flight and preserves rows while reading', async () => {
  const original = globalThis.setTimeout, callbacks = [];
  globalThis.setTimeout = fn => { callbacks.push(fn); return callbacks.length; };
  const f = idleStartSurface();
  try {
    await f.view.open();
    const rows = rowsOf(f);
    callbacks.at(-1)();
    sameNodes(rowsOf(f), rows);
    assert(rows.every(row => !row.disabled));
    assert.deepEqual(f.calls, ['read']);
    let resolve;
    f.host.liveTransport.music = () => { f.calls.push('refresh'); return new Promise(r => resolve = r); };
    click(f.view.refresh);
    click(f.view.refresh);
    assert.equal(f.view.refresh.disabled, true);
    sameNodes(rowsOf(f), rows);
    click(rows[1]);
    assert.equal(f.view.nextDestination ?? null, null);
    resolve(payload());
    await new Promise(r => setImmediate(r));
    assert.equal(f.view.refresh.disabled, false);
    assert.deepEqual(f.calls, ['read', 'refresh']);
  } finally {
    f.view.cleanup();
    globalThis.setTimeout = original;
  }
});

test('expired retained output is explicitly last-known while next destination remains intent only', async () => {
  const f = idleStartSurface();
  try {
    actualPlayback(f, {nativeRoomId: 'r0', nativeHomepodId: '42'});
    await f.view.open();
    const [actual, next] = rowsOf(f);
    click(next);
    f.view.validUntil = Date.now() - 1;
    f.view.sync();
    assert.equal(actual.children[2].textContent, 'Seneste output');
    assert.equal(next.children[2].textContent, 'Valgt');
    assert.equal(actual.getAttribute('aria-pressed'), 'false');
    assert.equal(next.getAttribute('aria-pressed'), 'true');
    assert(!actual.disabled && !next.disabled);
    f.view.nextDestination = {...f.view.nextDestination, speakerId: actual.speakerRow.speakerId};
    f.view.sync();
    assert.equal(actual.children[2].textContent, 'Valgt');
    assert.deepEqual(f.calls, ['read']);
  } finally {
    f.view.cleanup();
  }
});

test('idle selection immediately rerenders a fenced persistent next-destination label without issuing an effect',
  async () => {
    const f = idleStartSurface(), shown = [];
    try {
      f.host.liveMedia.render = () => shown.push(f.view.nextDestinationLabel());
      await f.view.open();
      click(rowsOf(f)[1]);
      assert.deepEqual(shown, ['Soveværelse']);
      assert.equal(f.view.nextDestinationLabel(), 'Soveværelse');
      assert.deepEqual(f.calls, ['read']);
      assert.equal(f.host.liveSnapshot.roomId, 'r0');
      const transport = f.host.liveTransport;
      f.host.liveTransport = {...transport};
      assert.equal(f.view.nextDestinationLabel(), '');
      f.host.liveTransport = transport;
      assert.equal(f.view.nextDestinationLabel(), 'Soveværelse');
      f.host.liveSnapshot.capabilities.musicSelection = false;
      assert.equal(f.view.nextDestinationLabel(), '');
      f.host.liveSnapshot.capabilities.musicSelection = true;
      f.view.cleanup();
      assert.equal(f.view.nextDestinationLabel(), '');
    } finally {
      f.view.cleanup();
    }
  });

test('persistent intent label cannot survive account/source/room/grant/transport replacement', async () => {
  for (const change of [
    f => f.host.liveMedia.account = 'other',
    f => f.host.liveSnapshot.bootId = 'next',
    f => f.host.liveSnapshot.roomId = 'next',
    f => f.host.liveSnapshot.mediaRoomBindings = [{bindingId: 'f'.repeat(64)}],
    f => f.host.liveSnapshot.capabilities.musicRead = [],
    f => f.host.liveSnapshot.capabilities.musicSelection = false,
    f => f.host.liveTransport = {...f.host.liveTransport},
    f => f.host.liveTransport.connected = false,
  ]) {
    const f = idleStartSurface();
    try {
      await f.view.open();
      click(rowsOf(f)[1]);
      assert.equal(f.view.nextDestinationLabel(), 'Soveværelse');
      change(f);
      assert.equal(f.view.nextDestinationLabel(), '');
      assert.deepEqual(f.calls, ['read']);
    } finally {
      f.view.cleanup();
    }
  }
});

test('configured default and native catalogue flags never establish an observed destination without playback proof',
  async () => {
    const f = configuredSurface();
    try {
      await f.view.refreshConfiguredLabel();
      assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
      assert.equal(f.view.actualLabel(null), '');
      assert.equal(f.view.observedDestination('a'.repeat(64)), false);
      assert.equal(f.view.observedDestination('b'.repeat(64)), false);
      assert.equal(f.host.liveMedia.playback, undefined);
    } finally {
      f.view.cleanup();
    }
  });

test('actual v2 native output is labelled independently of configured default and catalogue selection flags',
  async () => {
    const f = configuredSurface();
    try {
      const binding = actualPlayback(f), defaults = structuredClone(f.host.liveSnapshot.mediaRoomBindings);
      await f.view.refreshConfiguredLabel();
      assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
      assert.equal(f.view.actualLabel(binding), 'Soveværelse');
      assert.equal(f.view.observedDestination('b'.repeat(64)), true);
      assert.equal(f.view.observedDestination('a'.repeat(64)), false);
      assert.equal(f.view.labelValue.speakers[0].outputSelected, true);
      assert.equal(f.view.labelValue.speakers[1].outputSelected, null);
      assert.deepEqual(f.host.liveSnapshot.mediaRoomBindings, defaults);
      assert.equal(f.view.selectionDestination(), null);
    } finally {
      f.view.cleanup();
    }
  });

test('fresh admitted catalogue remains usable for actual output when no configured default exists', async () => {
  const f = surface(), calls = [];
  try {
    f.host.liveSnapshot.mediaRoomBindings = [];
    const binding = actualPlayback(f);
    f.host.liveTransport.music = async (...args) => { calls.push(args); return payload(); };
    await f.view.refreshConfiguredLabel();
    assert.equal(f.view.configuredLabel(), '');
    assert.equal(f.view.configuredDisplay, null);
    assert.equal(f.view.labelValue?.status, 'observed');
    assert.equal(f.view.actualLabel(binding), 'Soveværelse');
    assert.equal(f.view.observedDestination('b'.repeat(64)), true);
    assert.deepEqual(calls, [['speakers', 'account']]);
    assert.equal(f.view.selectionDestination(), null);
  } finally {
    f.view.cleanup();
  }
});

test('actual name formatting requires exact account room and HomePod identity, never a matching name', async () => {
  const f = configuredSurface();
  try {
    const binding = actualPlayback(f);
    await f.view.refreshConfiguredLabel();
    assert.equal(f.view.actualLabel(binding), 'Soveværelse');
    for (const change of [{accountId: 'other'}, {nativeRoomId: 'other'}, {nativeHomepodId: '42'},
      {nativeHomepodId: null}])
      assert.equal(f.view.actualLabel({...binding, ...change}), '');
    assert.equal(f.view.actualLabel(null), '');
  } finally {
    f.view.cleanup();
  }
});

test('expired actual proof and withdrawn playback read cannot be repaired by a fresh speaker catalogue', async () => {
  const f = configuredSurface();
  try {
    actualPlayback(f);
    await f.view.refreshConfiguredLabel();
    assert.equal(f.view.observedDestination('b'.repeat(64)), true);
    f.host.liveMedia.playback.roomBinding.validUntil = Date.now() / 1000 - 1;
    assert.equal(playbackBinding(f.host.liveMedia.playback, f.host.liveSnapshot, 'account'), null);
    assert.equal(f.view.observedDestination('b'.repeat(64)), false);
    assert.equal(f.view.actualLabel(playbackBinding(f.host.liveMedia.playback, f.host.liveSnapshot, 'account')), '');
    actualPlayback(f);
    f.host.liveSnapshot.capabilities.musicRead = ['targets'];
    assert.equal(f.view.observedDestination('b'.repeat(64)), false);
    assert.equal(f.view.configuredLabel(), 'Køkkenalrum HomePod');
  } finally {
    f.view.cleanup();
  }
});

for (const changed of ['malformed', 'account', 'transport', 'disconnect'])
  test(`actual output label does not survive ${changed} catalogue context`, async () => {
    const f = configuredSurface();
    try {
      const binding = actualPlayback(f);
      await f.view.refreshConfiguredLabel();
      assert.equal(f.view.actualLabel(binding), 'Soveværelse');
      if (changed === 'expired') f.view.labelValue.retrievedAt -= 31;
      if (changed === 'malformed') f.view.labelValue.extra = true;
      if (changed === 'account') f.host.liveMedia.account = 'other';
      if (changed === 'transport') f.host.liveTransport = {...f.host.liveTransport};
      if (changed === 'disconnect') f.host.liveTransport.connected = false;
      assert.equal(f.view.actualLabel(binding), '');
      assert.equal(f.view.observedDestination('b'.repeat(64)), false);
    } finally {
      f.view.cleanup();
    }
  });

test('native roster flags alone cannot mark current or last-known output rows', async () => {
  const f = surface();
  try {
    await f.view.open();
    const [defaultRow, other] = rowsOf(f);
    assert.equal(defaultRow.speakerRow.nativeSelected, true);
    assert.equal(defaultRow.speakerRow.outputSelected, true);
    assert.equal(defaultRow.getAttribute('aria-pressed'), 'false');
    assert.equal(defaultRow.children[2].textContent, 'Standardrum');
    assert.equal(other.getAttribute('aria-pressed'), 'false');
    assert.equal(other.children[2].textContent, '');
    f.view.validUntil = Date.now() - 1;
    f.view.sync();
    assert.equal(defaultRow.children[2].textContent, 'Standardrum');
    assert.equal(other.children[2].textContent, '');
  } finally {
    f.view.cleanup();
  }
});

test('actual nondefault native output wins contradictory roster flags and only blocks moving to its exact row',
  async () => {
    const f = idleStartSurface();
    try {
      actualPlayback(f);
      f.host.liveControls.musicContext = () => ({key: 'music'});
      f.host.liveControls.musicFence = null;
      f.host.liveTransport.music = async () => {
        const p = payload();
        p.moveAvailable = true;
        for (const row of p.speakers) Object.assign(row, {availability: 'available', selectable: true});
        return p;
      };
      await f.view.open();
      const [defaultRow, actual] = rowsOf(f);
      assert.equal(defaultRow.speakerRow.outputSelected, true);
      assert.equal(actual.speakerRow.outputSelected, null);
      assert.equal(defaultRow.getAttribute('aria-pressed'), 'false');
      assert.equal(defaultRow.children[2].textContent, 'Standardrum');
      assert.equal(defaultRow.disabled, false);
      assert.equal(actual.getAttribute('aria-pressed'), 'true');
      assert.equal(actual.children[2].textContent, 'Aktuelt output');
      assert.equal(actual.disabled, false);
      click(actual);
      assert.deepEqual(f.calls, [], 'choosing the current output moves nothing');
    } finally {
      f.view.cleanup();
    }
  });

test('explicit next choice captures native identity independently of later catalogue expiry', async () => {
  const f = idleStartSurface();
  try {
    await f.view.open();
    const row = rowsOf(f)[1];
    click(row);
    const expected = {accountId: row.speakerRow.accountId, nativeRoomId: row.speakerRow.nativeRoomId,
      nativeHomepodId: row.speakerRow.homepodId};
    assert.deepEqual(f.view.selectionWitness(), expected);
    assert.equal(Object.isFrozen(f.view.selectionWitness()), true);
    f.view.labelValue = null;
    f.view.validUntil = Date.now() - 1;
    assert.deepEqual(f.view.selectionWitness(), expected);
    f.host.liveTransport.connected = false;
    assert.throws(() => f.view.selectionWitness(), /expired/);
  } finally {
    f.view.cleanup();
  }
});

test('expired or failed catalogue retains exact validated actual alias as display only', async () => {
  const f = configuredSurface();
  try {
    const binding = actualPlayback(f);
    await f.view.refreshConfiguredLabel();
    assert.equal(f.view.actualLabel(binding), 'Soveværelse');
    f.view.labelValue.retrievedAt -= 31;
    assert.equal(f.view.actualLabel(binding), 'Soveværelse');
    assert.equal(f.view.observedDestination('b'.repeat(64)), false);
    f.view.labelValue = null;
    assert.equal(f.view.actualLabel(binding), 'Soveværelse');
    assert.equal(f.view.actualLabel({...binding, nativeHomepodId: '999'}), '');
    assert.equal(f.view.actualLabel(binding), '');
  } finally {
    f.view.cleanup();
  }
});

for (const change of ['boot', 'room', 'authority'])
  test('retained actual alias clears on ' + change, async () => {
    const f = configuredSurface();
    try {
      const binding = actualPlayback(f);
      await f.view.refreshConfiguredLabel();
      assert.equal(f.view.actualLabel(binding), 'Soveværelse');
      f.view.labelValue = null;
      if (change === 'boot') f.host.liveSnapshot.bootId = 'new';
      if (change === 'room') f.host.liveSnapshot.roomId = 'new';
      if (change === 'provider') f.host.liveSnapshot.providerGeneration = 99;
      if (change === 'authority') f.host.liveSnapshot.capabilities.musicRead = [];
      assert.equal(f.view.actualLabel(binding), '');
    } finally {
      f.view.cleanup();
    }
  });

test('identical refreshed catalogue retains row nodes and revalidates action authority at click', async () => {
  const f = idleStartSurface();
  try {
    await f.view.open();
    const first = rowsOf(f);
    await f.view.open();
    sameNodes(rowsOf(f), first);
    click(first[1]);
    assert.equal(f.view.selectionDestination().speakerId, 'b'.repeat(64));
    assert.deepEqual(f.calls, ['read', 'read']);
    f.view.nextDestination = null;
    f.host.liveSnapshot.capabilities.musicSelection = false;
    click(first[1]);
    assert.equal(f.view.nextDestination, null);
    assert.deepEqual(f.calls, ['read', 'read']);
  } finally {
    f.view.cleanup();
  }
});

test('changed label with unchanged target keeps the row and selects the newly read identity', async () => {
  const f = idleStartSurface();
  try {
    await f.view.open();
    const old = rowsOf(f)[1];
    f.host.liveTransport.music = async () => {
      const p = payload();
      for (const row of p.speakers) Object.assign(row, {availability: 'available', startSelectable: true});
      p.speakers[1].name = 'Andet navn';
      return p;
    };
    await f.view.open();
    assert.equal(rowsOf(f)[1], old);
    click(old);
    assert.equal(f.view.nextDestination.name, 'Andet navn');
  } finally {
    f.view.cleanup();
  }
});

test('fresh retained catalogue stays usable during quiet read but revocation and expiry still block', async () => {
  const f = idleStartSurface();
  try {
    await f.view.open();
    const row = rowsOf(f)[1];
    let resolve;
    f.host.liveTransport.music = () => new Promise(r => resolve = r);
    const pending = f.view.open();
    assert.equal(row.disabled, false);
    assert.equal(f.ids['room-options'].getAttribute('aria-busy'), 'false');
    f.host.liveSnapshot.capabilities.musicSelection = false;
    click(row);
    assert.equal(f.view.nextDestination ?? null, null);
    f.host.liveSnapshot.capabilities.musicSelection = true;
    f.view.validUntil = Date.now() - 1;
    click(row);
    assert.equal(f.view.nextDestination ?? null, null);
    resolve(payload());
    await pending;
  } finally {
    f.view.cleanup();
  }
});

test('expired speaker choice rereads once before selecting the same fresh identity', async () => {
  const f = idleStartSurface();
  try {
    f.ids.rooms.open = true;
    await f.view.open();
    const row = rowsOf(f)[1], names = rowsOf(f).map(node => node.speakerRow.name);
    click(row);
    const chosen = f.view.nextDestination;
    // The choice closed the real dialog (the fake one had no close()); the picker is open again for the next touch.
    f.ids.rooms.open = true;
    f.view.validUntil = Date.now() - 1;
    f.view.sync();
    assert.equal(row.getAttribute('aria-pressed'), 'true');
    assert.equal(row.disabled, false);
    assert.doesNotMatch(row.children[1].children[1].textContent, /udløbet/);
    assert.deepEqual(rowsOf(f).map(node => node.speakerRow.name), names);
    let release;
    f.host.liveTransport.music = () => { f.calls.push('fresh'); return new Promise(resolve => release = resolve); };
    click(row);
    assert.equal(f.view.nextDestination, chosen);
    assert.deepEqual(f.calls, ['read', 'fresh']);
    release((() => {
      const p = payload();
      for (const item of p.speakers) Object.assign(item, {availability: 'available', startSelectable: true});
      return p;
    })());
    await settle();
    assert.equal(f.view.nextDestination.speakerId, row.speakerRow.speakerId);
    assert.deepEqual(f.calls, ['read', 'fresh']);
  } finally {
    f.view.cleanup();
  }
});

for (const change of ['closed', 'reopened', 'identity', 'failed'])
  test(`expired speaker lookup never dispatches when ${change}`, async () => {
    const f = idleStartSurface();
    try {
      f.ids.rooms.open = true;
      await f.view.open();
      const row = rowsOf(f)[1];
      f.view.validUntil = Date.now() - 1;
      f.view.sync();
      let finish;
      f.host.liveTransport.music = () => new Promise((resolve, reject) => finish = {resolve, reject});
      click(row);
      assert.equal(f.view.nextDestination ?? null, null);
      if (change === 'closed' || change === 'reopened') {
        f.ids.rooms.close();
        if (change === 'reopened') f.ids.rooms.open = true;
      }
      if (change === 'failed') finish.reject(Error('offline'));
      else {
        const p = payload();
        for (const item of p.speakers) Object.assign(item, {availability: 'available', startSelectable: true});
        if (change === 'identity') p.speakers[1].homepodId = '44';
        finish.resolve(p);
      }
      await settle();
      assert.equal(f.view.nextDestination ?? null, null);
      assert.equal(f.calls.includes('MOVE'), false);
    } finally {
      f.view.cleanup();
    }
  });

for (const outcome of ['success', 'closed', 'reopened', 'failure', 'binding'])
  test(`touch joins existing expired roster read and ${outcome} is fenced`, async () => {
    const f = idleStartSurface();
    try {
      f.ids.rooms.open = true;
      await f.view.open();
      const row = rowsOf(f)[1];
      f.view.validUntil = Date.now() - 1;
      f.view.sync();
      let finish, reads = 0;
      f.host.liveTransport.music = () => {
        reads++;
        return new Promise((resolve, reject) => finish = {resolve, reject});
      };
      const refreshing = f.view.open();
      assert.equal(reads, 1);
      assert.equal(row.disabled, false);
      click(row);
      assert.equal(reads, 1, 'touch must join, never start another roster read');
      assert.equal(f.view.nextDestination ?? null, null);
      if (outcome === 'closed' || outcome === 'reopened') {
        f.ids.rooms.close();
        if (outcome === 'reopened') f.ids.rooms.open = true;
      }
      if (outcome === 'binding') f.host.liveSnapshot.roomId = 'changed';
      if (outcome === 'failure') finish.reject(Error('offline'));
      else {
        const p = payload();
        for (const r of p.speakers) Object.assign(r, {availability: 'available', startSelectable: true});
        finish.resolve(p);
      }
      await Promise.all([refreshing, settle()]);
      if (outcome === 'success') assert.equal(f.view.nextDestination?.speakerId, 'b'.repeat(64));
      else assert.equal(f.view.nextDestination ?? null, null);
      assert.equal(reads, 1);
      assert.equal(f.calls.includes('MOVE'), false);
    } finally {
      f.view.cleanup();
    }
  });

test('expired move reads fresh catalogue and sends exactly one admitted matching destination', async () => {
  const f = idleStartSurface(), moves = [];
  try {
    f.ids.rooms.open = true;
    actualPlayback(f, {nativeRoomId: 'r0', nativeHomepodId: '42'});
    f.host.liveControls.musicContext = () => ({key: 'music'});
    f.host.liveControls.musicFence = null;
    f.host.liveControls.moveSpeaker = (row, current) => {
      moves.push({id: row.speakerId, current: current()});
      return Promise.resolve(true);
    };
    f.host.liveTransport.music = async () => {
      const p = payload();
      p.moveAvailable = true;
      for (const row of p.speakers)
        Object.assign(row, {availability: 'available', selectable: true, startSelectable: true});
      return p;
    };
    await f.view.open();
    const target = rowsOf(f)[1];
    f.view.validUntil = Date.now() - 1;
    f.view.sync();
    let resolve, reads = 0;
    f.host.liveTransport.music = () => { reads++; return new Promise(r => resolve = r); };
    click(target);
    assert.equal(moves.length, 0);
    const updated = payload();
    updated.moveAvailable = true;
    for (const row of updated.speakers)
      Object.assign(row, {availability: 'available', selectable: true, startSelectable: true});
    resolve(updated);
    await settle();
    assert.equal(reads, 1);
    assert.deepEqual(moves, [{id: 'b'.repeat(64), current: true}]);
  } finally {
    f.view.cleanup();
  }
});

test('idle configured destination is selected at first load without executing or inventing output', async () => {
  const f = idleStartSurface();
  f.host.liveSnapshot.mediaRoomBindings = [{accountId: 'account', bindingId: 'a'.repeat(64), roomId: 'r0',
    targetId: 'engine', nativeRoomId: 'r0', nativeHomepodId: '42'}];
  try {
    const before = JSON.stringify(f.host.liveSnapshot);
    await f.view.open();
    const [standard, other] = rowsOf(f);
    assert.equal(standard.getAttribute('aria-pressed'), 'true');
    assert.equal(standard.children[2].textContent, 'Valgt');
    assert.equal(other.getAttribute('aria-pressed'), 'false');
    assert.equal(f.view.selectionDestination(), null);
    assert.equal(f.view.observedDestination(standard.speakerRow.speakerId), false);
    assert.equal(f.host.liveMedia.playback, undefined);
    assert.equal(JSON.stringify(f.host.liveSnapshot), before);
    assert.deepEqual(f.calls, ['read']);
    click(other);
    assert.equal(standard.getAttribute('aria-pressed'), 'false');
    assert.equal(other.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(f.calls, ['read']);
  } finally {
    f.view.cleanup();
  }
});

test('default marking requires the exact admitted destination and never replaces an observed output', async () => {
  for (const change of ['missing', 'mismatch', 'actual', 'stale', 'remembered']) {
    const f = idleStartSurface();
    f.host.liveSnapshot.mediaRoomBindings = [{accountId: 'account', bindingId: 'a'.repeat(64), roomId: 'r0',
      targetId: 'engine', nativeRoomId: 'r0', nativeHomepodId: '42'}];
    try {
      if (change === 'missing') f.host.liveSnapshot.mediaRoomBindings = [];
      if (change === 'mismatch') f.host.liveSnapshot.mediaRoomBindings[0].nativeHomepodId = '999';
      if (change === 'actual' || change === 'stale') actualPlayback(f);
      if (change === 'stale') f.host.liveMedia.playback.roomBinding.validUntil = Date.now() / 1000 - 1;
      if (change === 'remembered') f.view.actualDisplay = {name: 'Soveværelse'};
      await f.view.open();
      assert.equal(rowsOf(f)[0].getAttribute('aria-pressed'), 'false');
      assert.equal(f.view.nextDestination ?? null, null);
      assert.deepEqual(f.calls, ['read']);
    } finally {
      f.view.cleanup();
    }
  }
});

test('terminal music receipts release only the completed speaker-move fence', async () => {
  for (const action of ['pause', 'volume', 'move_existing_session'])
    for (const status of ['confirmed', 'rejected', 'superseded']) {
      const f = idleStartSurface(), moves = [];
      try {
        actualPlayback(f, {nativeRoomId: 'r0', nativeHomepodId: '42'});
        f.host.liveControls.musicContext = () => ({key: 'music'});
        f.host.liveControls.musicFence = {key: 'music', action, outcome: 'accepted', settlementStatus: status};
        f.host.liveControls.moveSpeaker = (row, current) => {
          moves.push({id: row.speakerId, current: current()});
          return Promise.resolve(true);
        };
        f.host.liveTransport.music = async () => {
          const p = payload();
          p.moveAvailable = true;
          for (const row of p.speakers) Object.assign(row, {availability: 'available', selectable: true});
          return p;
        };
        await f.view.open();
        const [actual, destination] = rowsOf(f);
        assert.equal(actual.disabled, false, 'current output is never locked');
        assert.equal(destination.disabled, false, `${action}/${status} releases the completed fence`);
        click(destination);
        assert.deepEqual(moves, [{id: 'b'.repeat(64), current: true}]);
      } finally {
        f.view.cleanup();
      }
    }
});

// A pending or unsettled music action no longer locks the rows (H1); the move waits instead.
test('unavailable output stays fenced; an unknown earlier outcome does not', async () => {
  for (const kind of ['unknown', 'unavailable', 'no_move']) {
    const f = idleStartSurface(), moves = [];
    try {
      actualPlayback(f, {nativeRoomId: 'r0', nativeHomepodId: '42'});
      f.host.liveControls.musicContext = () => ({key: 'music'});
      f.host.liveControls.musicFence = {key: 'music', action: 'volume',
        outcome: kind === 'unknown' ? 'unknown' : kind === 'pending' ? 'pending' : 'accepted',
        settlementStatus: kind === 'unconfirmed' ? 'unconfirmed'
          : ['busy', 'unavailable', 'no_move'].includes(kind) ? 'confirmed' : undefined};
      f.host.liveControls.musicIntentPending = ['busy', 'pending'].includes(kind);
      f.host.liveControls.moveSpeaker = (row, current) => {
        moves.push({id: row.speakerId, current: current()});
        return Promise.resolve(true);
      };
      f.host.liveTransport.music = async () => {
        const p = payload();
        p.moveAvailable = kind !== 'no_move';
        for (const row of p.speakers) Object.assign(row, {availability: 'available', selectable: true});
        if (kind === 'unavailable') p.speakers[1].availability = 'unavailable';
        return p;
      };
      await f.view.open();
      const destination = rowsOf(f)[1];
      f.view.sync();
      const open = kind === 'unknown';
      assert.equal(destination.disabled, !open, kind);
      click(destination);
      assert.equal(moves.length, open ? 1 : 0, kind);
    } finally {
      f.view.cleanup();
    }
  }
});

test('confirmed MOVE admits a second explicit MOVE after actual output changes', async () => {
  const f = idleStartSurface(), moves = [];
  try {
    actualPlayback(f, {nativeRoomId: 'r0', nativeHomepodId: '42'});
    f.host.liveControls.musicContext = () => ({key: 'music'});
    f.host.liveControls.musicFence = null;
    f.host.liveControls.moveSpeaker = (row, current) => {
      moves.push({id: row.speakerId, current: current()});
      return Promise.resolve(true);
    };
    f.host.liveTransport.music = async () => {
      const p = payload();
      p.moveAvailable = true;
      for (const row of p.speakers) Object.assign(row, {availability: 'available', selectable: true});
      return p;
    };
    await f.view.open();
    const [first, second] = rowsOf(f);
    click(second);
    actualPlayback(f, {nativeRoomId: 'r1', nativeHomepodId: '43'});
    f.host.liveControls.musicFence = {key: 'music', action: 'move_existing_session', outcome: 'accepted',
      settlementStatus: 'confirmed'};
    f.view.sync();
    assert.equal(second.disabled, false);
    click(second);
    assert.equal(first.disabled, false);
    click(first);
    assert.deepEqual(moves, [{id: 'b'.repeat(64), current: true}, {id: 'a'.repeat(64), current: true}]);
  } finally {
    f.view.cleanup();
  }
});

test('successive binding updates coalesce into one read for the latest scope', async () => {
  const f = idleStartSurface();
  try {
    f.ids.rooms.open = true;
    f.host.liveSnapshot.mediaRoomBindings = [{accountId: 'account', bindingId: 'a'.repeat(64), roomId: 'r0',
      targetId: 'engine', nativeRoomId: 'r0', nativeHomepodId: '42'}];
    await f.view.open();
    const row = rowsOf(f)[1];
    let calls = 0, resolve;
    f.host.liveTransport.music = () => { calls++; return new Promise(r => resolve = r); };
    for (const id of ['b', 'c']) {
      f.host.liveSnapshot.mediaRoomBindings = [{accountId: 'account', bindingId: id.repeat(64), roomId: 'r0',
        targetId: 'engine', nativeRoomId: 'r1', nativeHomepodId: '43'}];
      f.view.sync();
    }
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(rowsOf(f)[1], row);
    const latest = payload();
    for (const item of latest.speakers) Object.assign(item, {availability: 'available', startSelectable: true});
    resolve(latest);
    await new Promise(r => setImmediate(r));
    assert.equal(f.view.scope.key, f.view.context().key);
    assert.equal(f.view.validUntil > Date.now(), true);
  } finally {
    f.view.cleanup();
  }
});
