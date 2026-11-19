// Find musik → the existing start flow (LiveMusicSelectionView) with an inert transport: a tap starts that tile's
// context on the room's speaker through setup → offer → one action; the owner's player rules hold (every tap is
// sent and the last wins, nothing locks, an error is a short toast for that tap only, content in the first frame).
import assert from 'node:assert/strict';
import {afterEach, beforeEach, test, vi} from 'vitest';
import {ITEMS, liveFixture, shelvesBody} from './shelves-fixture.js';

let f;
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  f?.cleanup();
  f = null;
  vi.useRealTimers();
});

const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });
async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error('timed out');
    await new Promise(resolve => { setTimeout(resolve, 5); });
  }
}

test('a tap starts that tile\'s context on the room\'s speaker: one setup, one action, the right candidate', async () => {
  f = liveFixture();
  await f.shelves.read();
  f.tile('Blue').click();
  await until(() => f.sent.length === 1);
  assert.equal(f.setups.length, 1);
  assert.equal(f.setups[0].candidateSetId, 'a'.repeat(64));
  assert.deepEqual(f.setups[0].candidateIds, ['8'.padStart(24, 'a')]);
  assert.deepEqual(f.setups[0].issuedTarget, {accountId: 'account', kind: 'spotify_device', targetId: 'device',
    name: 'Stuen'});
  assert.equal(f.sent[0].offer.options[0].label, 'Blue');
  assert.equal(f.sent[0].offer.options[0].artist, 'Album');
  // The player is told what was wished for until the speaker reports it.
  assert.equal(f.view.pendingPlayer(f.view.feedback)?.uri, ITEMS[8].uri);
  assert.equal(f.reads.length, 1);
});

test('a tap after the one-minute choice set expired asks PodVoice again, then starts once', async () => {
  vi.useFakeTimers({toFake: ['Date']});
  f = liveFixture();
  await f.shelves.read();
  vi.setSystemTime(Date.now() + 61000);
  f.serve(shelvesBody({setId: 'd'.repeat(64)}));
  f.tile('Nina Simone').click();
  await until(() => f.sent.length === 1);
  assert.equal(f.reads.length, 2);
  assert.equal(f.setups.length, 1);
  assert.equal(f.setups[0].candidateSetId, 'd'.repeat(64));
  assert.deepEqual(f.setups[0].candidateIds, ['4'.padStart(24, 'd')]);
});

test('every tap is sent and the last one wins: taps during a start wait, only the newest follows', async () => {
  f = liveFixture();
  await f.shelves.read();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.host.liveTransport.musicSelectionAction = async (offer, optionId) => {
    f.sent.push({offer, optionId});
    if (f.sent.length === 1) await gate;
    return {ok: true, outcome: 'accepted', retryAllowed: false, physicalResultVerified: false, requestId: 'r'};
  };
  f.tile('Kind of Blue').click();
  await until(() => f.sent.length === 1);
  // Nothing locks while the first start is on its way.
  for (const button of f.root.querySelectorAll('button')) assert.equal(button.disabled, false);
  f.tile('Søndagsmorgen').click();
  f.tile('Det Røde Rum').click();
  release();
  await until(() => f.sent.length === 2);
  await settle();
  assert.deepEqual(f.sent.map(row => row.offer.options[0].label), ['Kind of Blue', 'Det Røde Rum']);
  assert.equal(f.setups.length, 2);
});

test('the same tile tapped again is a new start, never a lock', async () => {
  f = liveFixture();
  await f.shelves.read();
  f.tile('Blue').click();
  await until(() => f.sent.length === 1);
  await settle();
  f.tile('Blue').click();
  await until(() => f.sent.length === 2);
  assert.equal(f.setups.length, 2);
});

test('an error belongs to its tap: a short toast that clears itself and leaves no text on the player', async () => {
  f = liveFixture({setup: async () => ({ok: false, error: 'target_not_granted'})});
  await f.shelves.read();
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  f.tile('Blue').click();
  await vi.waitFor(() => assert.equal(f.root.querySelector('.find-toast').hidden, false));
  const toast = f.root.querySelector('.find-toast');
  assert.equal(toast.textContent, 'Højttaleren i rummet kan ikke bruges lige nu.');
  assert.equal(f.sent.length, 0);
  for (const button of f.root.querySelectorAll('button')) assert.equal(button.disabled, false);
  vi.advanceTimersByTime(3600);
  assert.equal(f.root.querySelector('.find-toast').hidden, true);
  assert.equal(f.view.feedback, null);
  vi.useRealTimers();
  // The next tap works as usual.
  f.host.liveTransport.musicSelectionSetup = async (candidateSetId, issuedTarget, candidateIds) => {
    f.setups.push({candidateSetId, issuedTarget, candidateIds});
    return {ok: true, schema: 'podview.music-selection.v1', candidateSetId, accountId: 'account',
      target: {kind: 'spotify_device', targetId: 'device'},
      taskId: 'music-selection:' + String(f.setups.length).padStart(32, 'e'), revision: 1,
      startVolumePercent: 35, expiresIn: 40, options: [{id: '0'.padStart(24, 'c'), label: 'Kind of Blue',
        artist: 'Album'}]};
  };
  f.tile('Kind of Blue').click();
  await until(() => f.sent.length === 1);
});

test('an unknown outcome is told honestly and is not cleared or resent', async () => {
  f = liveFixture({action: async () => ({ok: false, outcome: 'unknown', retryAllowed: false})});
  await f.shelves.read();
  f.tile('Blue').click();
  await until(() => f.sent.length === 1);
  await settle();
  assert.equal(f.view.feedback.outcome, 'unknown');
  assert.equal(f.root.querySelector('.find-toast').hidden, true);
  await new Promise(resolve => { setTimeout(resolve, 50); });
  assert.equal(f.sent.length, 1);
});

test('a screen without music access shows the shelves and explains a tap, without sending anything', async () => {
  f = liveFixture({selection: false, body: shelvesBody({candidate: false})});
  await f.shelves.read();
  assert.ok(f.root.querySelectorAll('.find-tile').length > 0);
  f.tile('Blue').click();
  await vi.waitFor(() => assert.equal(f.root.querySelector('.find-toast').hidden, false));
  assert.equal(f.setups.length, 0);
  assert.equal(f.sent.length, 0);
});

test('Find musik opens with the last-known page in its first frame and refreshes quietly', async () => {
  f = liveFixture();
  await f.shelves.read();
  const known = f.root.innerHTML;
  f.cleanup();
  // A reload: the same room and account show the stored page at once, before any read answers.
  f = liveFixture();
  let answer;
  f.serve(() => new Promise(resolve => { answer = resolve; }));
  f.shelves.open();
  assert.equal(f.root.querySelectorAll('.find-shelf').length, 8);
  assert.equal(f.root.querySelector('.find-empty'), null);
  assert.equal(f.reads.length, 1);
  const next = shelvesBody();
  next.shelves = next.shelves.filter(shelf => shelf.id !== 'podcasts');
  answer(next);
  await until(() => f.root.querySelectorAll('.find-shelf').length === 7);
  assert.notEqual(known, '');
});

test('while PodVoice renews its cache the page looks again, and replaces content in place', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  f = liveFixture({body: shelvesBody({refreshing: true})});
  await f.shelves.read();
  assert.equal(f.reads.length, 1);
  const next = shelvesBody();
  next.shelves[0] = {...next.shelves[0], title: 'Til en grå torsdag'};
  f.serve(next);
  vi.advanceTimersByTime(4000);
  vi.useRealTimers();
  await until(() => f.root.querySelector('[data-shelf=ai_moment] h2').textContent === 'Til en grå torsdag');
  assert.equal(f.reads.length, 2);
});

test('a failed read keeps the last-known page; nothing is emptied', async () => {
  f = liveFixture();
  await f.shelves.read();
  f.serve(() => Promise.reject(Object.assign(Error('music_unavailable'), {code: 'read_transient'})));
  assert.equal(await f.shelves.read(), false);
  assert.equal(f.root.querySelectorAll('.find-shelf').length, 8);
  assert.equal(f.root.querySelector('.find-empty'), null);
});
