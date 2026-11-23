// The speaker chip (#output) looks like a picker, so it opens the speaker dialog even while the music plays on
// another device. Only the player's »Flyt til <rum>« button (#move-here) moves the playback at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../../podview/widget-view.js', import.meta.url), 'utf8');
const slice = (start, end) => {
  const from = source.indexOf(start);
  assert.ok(from > 0, start);
  return source.slice(from, source.indexOf(end, from)).trim();
};
const openMethod = slice('\n open(id,opener){', '\n renderScreenSettings(){');
const moveMethod = slice('\n moveHere(){', '\n renderTopbarClock(');

function fixture({elsewhere = true, canMove = true} = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {id, open: false, showModal() { this.open = true; }, getClientRects: () => [1]});
    return nodes.get(id);
  };
  const intents = [], outputs = [];
  const host = {
    live: true,
    openers: new Map(),
    liveRadio: {ownsPlayer: () => false, setState: () => undefined},
    liveMedia: {playback: {elsewhere}},
    liveControls: {player: {can: action => canMove && action === 'move_here'}, musicIntent: action => intents.push(action)},
    liveOutputs: {open: () => outputs.push('open')},
  };
  const build = method => new Function('$', 'document', `return function ${method.replace(/^\s*/, '')}`)(node, {});
  host.open = build(openMethod);
  host.moveHere = build(moveMethod);
  return {host, node, intents, outputs};
}

test('the speaker chip opens the speaker dialog while the music plays on another device', () => {
  const f = fixture();
  f.host.open('rooms', f.node('output'));
  assert.equal(f.node('rooms').open, true, 'the speaker dialog opens');
  assert.deepEqual(f.outputs, ['open'], 'the speaker list is read');
  assert.deepEqual(f.intents, [], 'no move is sent from the chip');
});

test('»Flyt til <rum>« in the player still moves the playback at once', () => {
  const f = fixture();
  f.host.moveHere();
  assert.deepEqual(f.intents, ['move_here']);
  assert.equal(f.node('rooms').open, false, 'no chooser opens');
});

test('»Flyt til <rum>« without a move grant opens the speaker dialog instead', () => {
  const f = fixture({canMove: false});
  f.host.moveHere();
  assert.deepEqual(f.intents, []);
  assert.equal(f.node('rooms').open, true);
});
