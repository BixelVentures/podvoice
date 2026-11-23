import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createQueryClient} from '../query/client';
import {createCommandStore, NOTICE_MS, WISH_TIMEOUT_MS} from './commands';
import {createFakeHass} from './ha-fixture';
import {lightCommands, powerKey} from './lights';
import {mediaCommands, playKey, volumeKey} from './media';
import {createHaTransport} from './transport';

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
});
