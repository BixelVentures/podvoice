import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createQueryClient} from '../query/client';
import {createCommandStore, NOTICE_MS, WISH_TIMEOUT_MS} from './commands';
import {createFakeHass} from './ha-fixture';
import {lightCommands, powerKey} from './lights';
import {mediaCommands, playKey, skipKey, volumeKey, volumeTolerance} from './media';
import {settleTimerWishes, timerCommands, timerWishKey} from './timers';
import {callService, createHaTransport, readFailure} from './transport';

function setup() {
  const client = createQueryClient();
  const transport = createHaTransport(client);
  const fake = createFakeHass({confirmMs: 100, onChange: hass => {
    transport.setHass(hass);
  }});
  transport.setHass(fake.hass);
  const store = createCommandStore(transport);
  return {fake, store, transport};
}

describe('HA command lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the wish at once and ends it when HA shows the effect', async () => {
    const {fake, store} = setup();
    const media = mediaCommands(store);
    media.playPause('media_player.kokkenalrum', false);
    expect(store.store.getState().wishes[playKey('media_player.kokkenalrum')]).toMatchObject({
      value: 'paused', phase: 'sending'});
    await vi.advanceTimersByTimeAsync(0);
    expect(store.store.getState().wishes[playKey('media_player.kokkenalrum')]?.phase).toBe('awaiting');
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.hass.states['media_player.kokkenalrum']?.state).toBe('paused');
    expect(store.store.getState().wishes[playKey('media_player.kokkenalrum')]).toBeUndefined();
  });

  it('never locks: the last tap wins and is sent, an earlier answer no longer counts', async () => {
    const {fake, store} = setup();
    const media = mediaCommands(store);
    media.volume('media_player.kokkenalrum', 0.4);
    media.volume('media_player.kokkenalrum', 0.6);
    expect(fake.calls.map(call => call.data.volume_level)).toEqual([0.4, 0.6]);
    await vi.advanceTimersByTimeAsync(100);
    // HA's 0.4 arrives first: not the wish; then 0.6 confirms it.
    expect(store.store.getState().wishes[volumeKey('media_player.kokkenalrum')]).toBeUndefined();
    expect(fake.hass.states['media_player.kokkenalrum']?.attributes.volume_level).toBe(0.6);
  });

  it('turns an unconfirmed wish into an honest unknown and never resends it', async () => {
    const {fake, store} = setup();
    fake.mode = 'silent';
    lightCommands(store).power('light.kokken_o', true);
    await vi.advanceTimersByTimeAsync(WISH_TIMEOUT_MS);
    expect(store.store.getState().wishes[powerKey('light.kokken_o')]?.phase).toBe('unknown');
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(NOTICE_MS);
    expect(store.store.getState().wishes[powerKey('light.kokken_o')]).toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });

  it('shows HA refusal as rejected and lets the next tap through', async () => {
    const {fake, store} = setup();
    fake.mode = 'refuse';
    const lights = lightCommands(store);
    lights.power('light.kokken_o', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.store.getState().wishes[powerKey('light.kokken_o')]).toMatchObject({phase: 'rejected'});
    fake.mode = 'confirm';
    lights.power('light.kokken_o', true);
    expect(store.store.getState().wishes[powerKey('light.kokken_o')]?.phase).toBe('sending');
    await vi.advanceTimersByTimeAsync(100);
    expect(store.store.getState().wishes[powerKey('light.kokken_o')]).toBeUndefined();
    expect(fake.calls).toHaveLength(2);
  });

  it('ends at once when the effect is already shown (play while playing)', async () => {
    const {store} = setup();
    mediaCommands(store).playPause('media_player.kokkenalrum', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.store.getState().wishes[playKey('media_player.kokkenalrum')]).toBeUndefined();
  });

  it('a lost connection mid-call leaves the outcome unknown', async () => {
    const {fake, store} = setup();
    fake.mode = 'drop';
    lightCommands(store).power('light.kokken_o', true);
    await vi.advanceTimersByTimeAsync(WISH_TIMEOUT_MS);
    expect(store.store.getState().wishes[powerKey('light.kokken_o')]?.phase).toBe('unknown');
  });

  it('a call without a link is »not sent«, never »unknown«, and never reaches HA', async () => {
    const {fake, store, transport} = setup();
    fake.setConnected(false);
    expect(await callService({domain: 'light', service: 'turn_on', entityId: 'light.kokken_o'}, transport)).toEqual({
      ok: false, outcome: 'not_sent', reason: 'not_connected'});
    lightCommands(store).power('light.kokken_o', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.store.getState().wishes[powerKey('light.kokken_o')]?.phase).toBe('not_sent');
    expect(fake.calls).toHaveLength(0);
  });

  it('reads the websocket library\'s numeric connection-lost error as not sent, an in-flight loss as unknown', () => {
    expect(readFailure(3)).toEqual({outcome: 'not_sent', reason: 'not_connected'});
    expect(readFailure(1)).toEqual({outcome: 'not_sent', reason: 'not_connected'});
    expect(readFailure({code: 3, message: 'Connection lost'})).toEqual({outcome: 'unknown', reason: 'Connection lost'});
  });

  it('skip: a song ending by itself while the call is on its way never confirms a refused skip', async () => {
    const {fake, store, transport} = setup();
    let refuse: (error: unknown) => void = () => undefined;
    fake.hass.callService = () => new Promise((_, reject) => { refuse = reject; });
    transport.setHass(fake.hass);
    mediaCommands(store).skip('media_player.kokkenalrum', 'next');
    // The track changes naturally before HA answers.
    fake.hass.callService = createFakeHass().hass.callService;
    fake.patch('media_player.kokkenalrum', null, {media_title: 'Something else', media_content_id: 'x'});
    expect(store.store.getState().wishes[skipKey('media_player.kokkenalrum')]?.phase).toBe('sending');
    refuse(Object.assign(new Error('Service not allowed'), {code: 'not_allowed'}));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.store.getState().wishes[skipKey('media_player.kokkenalrum')]?.phase).toBe('rejected');
  });

  it('skip: confirmed by a new track once HA answered', async () => {
    const {store} = setup();
    mediaCommands(store).skip('media_player.kokkenalrum', 'next');
    await vi.advanceTimersByTimeAsync(0);
    expect(store.store.getState().wishes[skipKey('media_player.kokkenalrum')]?.phase).toBe('awaiting');
    await vi.advanceTimersByTimeAsync(100);
    expect(store.store.getState().wishes[skipKey('media_player.kokkenalrum')]).toBeUndefined();
  });

  it('volume: the tolerance follows the speaker\'s volume step', async () => {
    const {fake, store, transport} = setup();
    expect(volumeTolerance(null)).toBeCloseTo(0.011);
    fake.patch('media_player.kokkenalrum', null, {volume_step: 1 / 16});
    expect(volumeTolerance(transport.read('media_player.kokkenalrum'))).toBeCloseTo(1 / 32 + 0.001);
    // The speaker can only show 0.4375 for a wish of 0.45: that is the wish, in its steps.
    fake.hass.callService = () => Promise.resolve({});
    transport.setHass(fake.hass);
    mediaCommands(store).volume('media_player.kokkenalrum', 0.45);
    await vi.advanceTimersByTimeAsync(0);
    fake.patch('media_player.kokkenalrum', null, {volume_level: 0.4375});
    expect(store.store.getState().wishes[volumeKey('media_player.kokkenalrum')]).toBeUndefined();
  });

  it('timer: one wish per timer, and only a read newer than the answer settles it', async () => {
    const {fake, store} = setup();
    const send = timerCommands(store);
    send('kokken', 'e'.repeat(32), {action: 'start', seconds: 180, name: ''});
    send('kokken', 'e'.repeat(32), {action: 'cancel', timerId: 't9'});
    const wishes = store.store.getState().wishes;
    expect(Object.keys(wishes).sort()).toEqual([timerWishKey('kokken', 'id:t9'), timerWishKey('kokken', 'start')]);
    // A read from before the answer proves nothing.
    const before = Date.now();
    await vi.advanceTimersByTimeAsync(5);
    const start = store.store.getState().wishes[timerWishKey('kokken', 'start')];
    expect(start?.phase).toBe('awaiting');
    settleTimerWishes(store, 'kokken', before);
    expect(store.store.getState().wishes[timerWishKey('kokken', 'start')]?.phase).toBe('awaiting');
    settleTimerWishes(store, 'kokken', start?.answeredAt ?? 0);
    expect(store.store.getState().wishes[timerWishKey('kokken', 'start')]?.phase).toBe('awaiting');
    settleTimerWishes(store, 'kokken', (start?.answeredAt ?? 0) + 1);
    expect(store.store.getState().wishes[timerWishKey('kokken', 'start')]).toBeUndefined();
    expect(fake.calls.filter(call => call.service === 'timer_command_v2')).toHaveLength(2);
  });
});
