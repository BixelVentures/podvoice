// The shared player's source focus (session.ts): music, radio or auto, scoped to boot and room. Moved from
// tests/podview/connection-radio-state.test.mjs (PlayerView's prototype over a fake host) to Vitest with the session.
// Same assertions.
import assert from 'node:assert/strict';
import {afterEach, test} from 'vitest';
import {beginSourceFocus, currentSourceFocus, finishSourceFocus, focusSource, resetSession, sourceFocused}
  from './session';
import {bindPlayer, resetPlayer} from './store';

const snapshot = {bootId: 'boot', roomId: 'room', providerGeneration: 4, sessionId: null, taskId: null,
  inputRevision: 1};
afterEach(() => {
  resetPlayer();
  resetSession();
});
function player() {
  const host = {liveSnapshot: snapshot, liveRadio: {closeOutputs() {}}};
  bindPlayer(host);
  return host;
}

test('source focus is explicit: auto until a source is chosen, scoped to boot and room', () => {
  const host = player();
  assert.equal(sourceFocused('music'), true);
  assert.equal(sourceFocused('radio'), true);
  assert.equal(currentSourceFocus().kind, 'auto');
  focusSource('radio');
  assert.equal(sourceFocused('music'), false);
  host.liveSnapshot = {...snapshot, roomId: 'other'};
  assert.equal(sourceFocused('music'), true);
  assert.equal(currentSourceFocus().kind, 'auto');
});

for (const outcome of ['rejected', 'unknown'])
  test(`bug: finishSourceFocus reverts on ${outcome}`, () => {
    player();
    focusSource('radio');
    const ticket = beginSourceFocus('music');
    assert.equal(currentSourceFocus().kind, 'music');
    assert.equal(finishSourceFocus(ticket, outcome), true);
    assert.equal(currentSourceFocus().kind, 'radio');
  });

test('an accepted source focus stays', () => {
  player();
  const ticket = beginSourceFocus('music');
  assert.equal(finishSourceFocus(ticket, 'accepted'), false);
  assert.equal(currentSourceFocus().kind, 'music');
});
