// What the player says for one model (presentation.ts) and the live models it is given (player-model.ts): pure
// functions, word for word the pre-React player-view.js's texts.
import {describe, expect, test} from 'vitest';
import {OTHER_ACCOUNT, livePlayerModel, liveQueueModel} from './player-model';
import {formatTime, playerFaces, progressFaces, queueFaces, queueRowFaces, transportFaces, volumeKnown}
  from './presentation';
import type {QueueItem} from './types';

const NOON = Date.parse('2026-11-23T12:00:00+01:00');
const playing = {active: true, playing: true, fresh: true, title: 'Song', artist: 'Artist', target: 'Køkken',
  canOutput: true};

describe('playerFaces', () => {
  test('an empty player never fabricates playback or an output', () => {
    for (const status of ['loading', 'error', 'ready']) {
      const faces = playerFaces(livePlayerModel(null, true, status, null), 'now', NOON);
      expect(faces.active).toBe(false);
      expect(faces.title).toBe('');
      expect(faces.room).toBe('');
      expect(faces.output.disabled).toBe(true);
    }
    expect(playerFaces({active: false, loading: true}, 'now', NOON).message).toBe('Henter afspilningsstatus');
    expect(playerFaces({active: false, emptyState: 'error'}, 'now', NOON).message)
      .toBe('Afspilningen kunne ikke hentes.');
    expect(playerFaces({active: false, emptyState: 'offline'}, 'now', NOON).message)
      .toBe('Afspilningen kan ikke hentes offline.');
    expect(playerFaces({active: false, feedback: {message: 'Starter afspilning…', pending: true}}, 'now', NOON))
      .toMatchObject({message: 'Starter afspilning…', pending: true, emptyState: 'pending', busy: true,
        selectionFeedback: true});
  });

  test('the empty card’s music entry carries the part of the day, or the account choice', () => {
    const music = playerFaces({active: false, canDiscover: true}, 'now', NOON).find;
    expect(music).toEqual({label: 'Vælg musik', context: 'Til eftermiddagen', action: 'music', disabled: false,
      hidden: false});
    expect(playerFaces({active: false, canDiscover: true}, 'music', NOON).find.hidden).toBe(true);
    const account = playerFaces({active: false, emptyState: 'account-selection', canChooseAccount: true}, 'music',
      NOON).find;
    expect(account).toEqual({label: 'Vælg musikkonto', context: '', action: 'account', disabled: false,
      hidden: false});
  });

  test('state line and output labels: playing, paused, stale, error, switching', () => {
    expect(playerFaces(playing, 'now').stateLabel).toBe('Spiller på');
    expect(playerFaces(playing, 'now').output.label).toBe('Spiller på · Køkken · Aktuelt output · Vælg højttaler');
    expect(playerFaces(playing, 'now').detailOutput.label).toBe('Køkken · Aktuelt output · Vælg højttaler');
    expect(playerFaces({...playing, playing: false}, 'now').output.label)
      .toBe('På pause · Køkken · Aktuelt output · Vælg højttaler');
    const stale = playerFaces({...playing, fresh: false}, 'now');
    expect([stale.stateLabel, stale.detailStatus]).toEqual(['Ikke opdateret', 'Afspilningen er ikke opdateret']);
    expect(stale.output.label).toContain('Seneste output');
    expect(playerFaces({...playing, fresh: false, connectionExplained: true}, 'now').stateLabel).toBe('');
    expect(playerFaces({...playing, emptyState: 'error', fresh: false}, 'now').stateLabel)
      .toBe('Status kunne ikke hentes');
    expect(playerFaces({...playing, emptyState: 'error', connectionExplained: true}, 'now').stateLabel)
      .toBe('Forbindelsen mangler');
    const switching = playerFaces({...playing, selectedTarget: 'Frida'}, 'now');
    expect([switching.stateLabel, switching.room]).toEqual(['Skifter til', 'Frida']);
    expect(switching.output.label).toBe('Skifter til · Valgt: Frida · skifter højttaler · Afventer bekræftelse · ' +
      'Vælg højttaler');
    expect(playerFaces({...playing, controlStatus: 'Skærmen har ikke adgang · Tilknyt'}, 'now').stateLabel)
      .toBe('Skærmen har ikke adgang · Tilknyt');
  });

  test('read-only placements: elsewhere and another account', () => {
    const away = playerFaces({...playing, readOnly: true, placement: 'elsewhere', target: '', configuredTarget: 'Køkken'},
      'now');
    expect(away.stateLabel).toBe('Spiller et andet sted');
    expect(away.moveHere).toMatchObject({hidden: false, action: 'move', label: 'Flyt til Køkken'});
    const other = playerFaces({...playing, readOnly: true, placement: 'other-account', canOutput: false,
      canDiscover: true}, 'now');
    expect([other.stateLabel, other.detailStatus, other.placement]).toEqual([OTHER_ACCOUNT, OTHER_ACCOUNT,
      'other-account']);
    expect(other.moveHere).toMatchObject({hidden: false, action: 'music', label: 'Vælg musik'});
    expect(playerFaces({...playing, readOnly: true, placement: 'other-account', canDiscover: false}, 'now')
      .moveHere.hidden).toBe(true);
  });

  test('radio: no state line, its live phase and the stop icon', () => {
    const radio = {...playing, sourceKind: 'radio', artist: ''};
    expect(playerFaces(radio, 'now')).toMatchObject({stateHidden: true, artist: 'Direkte radio',
      radioLive: {hidden: false, phase: 'live', word: 'Direkte'}, playIcon: 'assets/icons/stop-fill.svg'});
    expect(playerFaces({...radio, loading: true, playing: false}, 'now').radioLive)
      .toEqual({hidden: false, phase: 'starting', word: 'Forbinder'});
    expect(playerFaces({...radio, playing: false}, 'now').radioLive.word).toBe('Stoppet');
    expect(playerFaces({...radio, exampleOnly: true, previewLabel: 'Eksempel'}, 'now').output.label)
      .toMatch(/^Eksempel · /);
  });
});

test('progressFaces: known positions only, labelled by their source', () => {
  const vm = {active: true, progressMs: 84000, durationMs: 187000, positionFresh: true};
  expect(progressFaces(vm)).toMatchObject({known: true, elapsed: '1:24', duration: '3:07', stale: false,
    label: 'Observeret position: 1:24 af 3:07. Kun visning.'});
  expect(progressFaces({...vm, interpolatedPosition: true}).label).toMatch(/^Beregnet position/);
  expect(progressFaces({...vm, examplePosition: true}).label).toMatch(/^Eksempelposition/);
  expect(progressFaces({...vm, positionFresh: false})).toMatchObject({stale: true});
  for (const patch of [{progressMs: null}, {progressMs: 188000}, {progressMs: -1}, {durationMs: 0}, {active: false},
    {progressMs: 1.5}])
    expect(progressFaces({...vm, ...patch})).toMatchObject({known: false, elapsed: '', progressMs: 0, durationMs: 1});
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(3601)).toBe('60:01');
});

test('transportFaces: grants, blocked and the radio toggle', () => {
  expect(transportFaces({playing: true, previous: true, next: false, toggle: true})).toMatchObject({
    previousDisabled: false, nextDisabled: true, toggleDisabled: false, toggleLabel: 'Sæt musik på pause',
    skipHidden: false});
  expect(transportFaces({blocked: true, previous: true, next: true, toggle: true})).toMatchObject({
    previousDisabled: true, nextDisabled: true, toggleDisabled: true, toggleLabel: 'Fortsæt musikken'});
  expect(transportFaces({sourceKind: 'radio', playing: false, toggle: true}).toggleLabel)
    .toBe('Start radio ved livepunkt');
  expect(transportFaces({sourceKind: 'radio', playing: true, pendingLabel: 'Stopper radio…'})).toMatchObject({
    toggleLabel: 'Stopper radio…', skipHidden: true});
  expect([0, 100, 40].every(volumeKnown)).toBe(true);
  expect([null, undefined, -1, 101, 2.5].some(volumeKnown)).toBe(false);
});

describe('queue', () => {
  const one: QueueItem = {id: 'a', title: 'One', artist: 'X', order: 1, selectable: true};
  const two: QueueItem = {id: 'b', title: 'Two', artist: 'Y', order: 2};
  const rows = [one, two];

  test('meta line, label, placeholders and empty text follow the queue state', () => {
    expect(queueFaces(rows, {}, playing, false, 'Køkken')).toMatchObject({meta: '2 numre · Køkken', label: 'Kø',
      status: 'ready', busy: false, placeholders: false, empty: '', hidden: false});
    expect(queueFaces([one], {}, playing, false, '').meta).toBe('1 nummer');
    expect(queueFaces([], {status: 'loading', placeholders: true}, playing, false, '')).toMatchObject({meta: '',
      busy: true, placeholders: true, empty: ''});
    expect(queueFaces([], {}, playing, false, '').empty).toBe('Ingen sange i køen.');
    expect(queueFaces(rows, {status: 'stale'}, playing, false, '')).toMatchObject({meta: 'Køen er ikke opdateret',
      label: 'Køen er ikke opdateret'});
    expect(queueFaces([], {status: 'error', errorKind: 'choice'}, playing, false, '')).toMatchObject({
      meta: 'Køvalget blev afvist', label: 'Køvalget blev afvist'});
    expect(queueFaces([], {status: 'error'}, playing, false, '').meta).toBe('Køen kunne ikke hentes');
    expect(queueFaces([], {status: 'unknown'}, playing, false, '').meta).toBe('Afspilning ikke bekræftet');
    expect(queueFaces(rows, {sourceKind: 'radio'}, playing, false, '').hidden).toBe(true);
  });

  test('the live playing song is added first only when known, fresh, in the room and not listed', () => {
    const vm = {...playing, uri: 'spotify:track:' + 'a'.repeat(22), metadataKnown: true};
    expect(queueFaces(rows, {}, vm, true, '').items[0]).toMatchObject({current: true, playing: true, order: 0});
    expect(queueFaces(rows, {}, vm, false, '').items).toHaveLength(2);
    for (const patch of [{fresh: false}, {readOnly: true}, {metadataKnown: false}, {uri: undefined}])
      expect(queueFaces(rows, {}, {...vm, ...patch}, true, '').items).toHaveLength(2);
    expect(queueFaces([{...one, current: true}], {}, vm, true, '').items).toHaveLength(1);
  });

  test('row faces: place, pending start, current playing or paused', () => {
    expect(queueRowFaces(one)).toMatchObject({label: 'Afspil 1 · One · X', slot: 'text', playback: 'upcoming'});
    expect(queueRowFaces(two).label).toBe('Kun visning: 2 · Two · Y');
    expect(queueRowFaces({...one, pending: true})).toMatchObject({label: 'Starter: 1 · One · X', pending: true});
    expect(queueRowFaces({...one, current: true, playing: true})).toMatchObject({
      label: 'Spiller nu: One · X · Sæt på pause', slot: 'eq', slotLabel: 'Spiller nu', playback: 'playing',
      playIcon: 'assets/icons/pause-fill.svg'});
    expect(queueRowFaces({...one, current: true, playing: false})).toMatchObject({
      label: 'På pause: One · X · Fortsæt', slot: 'icon', icon: 'assets/icons/pause-fill.svg', playback: 'paused'});
    expect(queueRowFaces({...one, current: true})).toMatchObject({label: 'Aktuelt nummer: One · X',
      playback: 'unknown'});
    expect(queueRowFaces({...one, displayId: 'shown'}).key).toBe('shown');
  });

  test('live queue rows are observations, never play grants', () => {
    const queue = {items: [0, 1].map(index => ({id: `snapshot:${String(index)}`, type: 'track' as const,
      uri: 'spotify:track:' + 'b'.repeat(22), name: 'Repeat', artists: ['A', 'B'], duration_ms: 1}))};
    expect(liveQueueModel(queue)).toEqual([0, 1].map(index => ({id: `snapshot:${String(index)}`, title: 'Repeat',
      artist: 'A, B', uri: 'spotify:track:' + 'b'.repeat(22), artwork: undefined, order: index + 1,
      selectable: false})));
  });
});

test('livePlayerModel: an honest empty or account prompt, never an invented room', () => {
  expect(livePlayerModel(null, true, 'account-selection', null)).toMatchObject({active: false,
    emptyState: 'account-selection', empty: 'Vælg en musikkonto.', loading: false});
  expect(livePlayerModel(null, false, 'ready', null)).toMatchObject({emptyState: 'offline',
    empty: 'Forbindelsen mangler.', canOutput: false, canDiscover: false});
  expect(livePlayerModel(null, true, 'loading', null)).toMatchObject({emptyState: 'loading', loading: true, empty: ''});
  expect(livePlayerModel(null, true, 'ready', {capabilities: {musicRead: ['targets', 'mood']}}, 'Køkken'))
    .toMatchObject({canOutput: true, canDiscover: true, target: '', configuredTarget: 'Køkken'});
});
