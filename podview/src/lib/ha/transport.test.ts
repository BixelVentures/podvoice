import {QueryObserver} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {describe, expect, it, vi} from 'vitest';
import {createQueryClient} from '../query/client';
import {createFakeHass} from './ha-fixture';
import {callService, createHaTransport, haKeys, readFailure, subscribeHa} from './transport';
import type {Hass} from './hass';
import type {Catalog} from './catalog';

function setup() {
  const client: QueryClient = createQueryClient();
  const transport = createHaTransport(client);
  const fake = createFakeHass({onChange: hass => {
    transport.setHass(hass);
  }});
  transport.setHass(fake.hass);
  return {client, transport, fake};
}

describe('HA transport', () => {
  it('writes each watched entity into the cache and rooms from HA areas', () => {
    const {client} = setup();
    expect(client.getQueryData(haKeys.entity('light.kokken_loft'))).toMatchObject({state: 'on'});
    const catalog = client.getQueryData<Catalog>(haKeys.catalog);
    expect(catalog?.rooms.map(room => room.name)).toEqual(['Køkkenalrum', 'Stue']);
    // The device's area places the ceiling light; only PodConnect's players are room players.
    expect(catalog?.rooms[0]).toMatchObject({lights: ['light.kokken_loft', 'light.kokken_o',
      'light.kokkenalrum_kokkenalrum'],
      players: ['media_player.kokkenalrum']});
    expect(catalog?.rooms[1]?.players).toEqual(['media_player.stue']);
    expect(catalog?.weather).toEqual(['weather.forecast_hjem']);
  });

  it('notifies nobody about an unrelated entity change (structural sharing, identity skip)', () => {
    const {client, fake} = setup();
    const lamp = new QueryObserver(client, {queryKey: haKeys.entity('light.kokken_loft'), enabled: false,
      notifyOnChangeProps: ['data']});
    const rooms = new QueryObserver(client, {queryKey: haKeys.catalog, enabled: false,
      notifyOnChangeProps: ['data']});
    const lampSeen = vi.fn();
    const roomsSeen = vi.fn();
    const stopLamp = lamp.subscribe(lampSeen);
    const stopRooms = rooms.subscribe(roomsSeen);
    const before = client.getQueryData(haKeys.entity('light.kokken_loft'));
    fake.patch('media_player.kokkenalrum', null, {volume_level: 0.5});
    expect(lampSeen).not.toHaveBeenCalled();
    expect(roomsSeen).not.toHaveBeenCalled();
    expect(client.getQueryData(haKeys.entity('light.kokken_loft'))).toBe(before);
    fake.patch('light.kokken_loft', 'off');
    expect(lampSeen).toHaveBeenCalledTimes(1);
    stopLamp();
    stopRooms();
  });

  it('resync re-reads everything and bumps the generation for reads HA does not push', () => {
    const {client, transport} = setup();
    expect(client.getQueryData(haKeys.link)).toEqual({connected: true, generation: 0});
    client.setQueryData(haKeys.entity('light.kokken_o'), null);
    transport.resync();
    expect(client.getQueryData(haKeys.link)).toEqual({connected: true, generation: 1});
    expect(client.getQueryData(haKeys.entity('light.kokken_o'))).toMatchObject({state: 'off'});
  });

  it('HA\'s websocket coming back (connected false → true) starts a new generation, as a wake-up does', () => {
    const {client, transport, fake} = setup();
    const before = client.getQueryData<{generation: number}>(haKeys.link)?.generation ?? 0;
    fake.setConnected(false);
    expect(client.getQueryData<{connected: boolean}>(haKeys.link)?.connected).toBe(false);
    expect(client.getQueryData<{generation: number}>(haKeys.link)?.generation).toBe(before);
    fake.setConnected(true);
    expect(client.getQueryData<{connected: boolean; generation: number}>(haKeys.link)).toEqual({
      connected: true,
      generation: before + 1,
    });
    // An ordinary new `hass` (a state change) is not a reconnect.
    fake.patch('light.kokken_o', 'on');
    expect(client.getQueryData<{generation: number}>(haKeys.link)?.generation).toBe(before + 1);
    expect(transport.connected()).toBe(true);
  });

  it('a subscription HA refuses (the bridge is not ready) is tried again with backoff until it starts', async () => {
    vi.useFakeTimers();
    try {
      const transport = createHaTransport(createQueryClient());
      let attempts = 0;
      const pushed: unknown[] = [];
      const errors: string[] = [];
      const subscribeMessage = (push: (message: unknown) => void) => {
        attempts += 1;
        if (attempts < 3) return Promise.reject(Object.assign(new Error('not ready'), {code: 'home_assistant_error'}));
        push({ok: true});
        return Promise.resolve(() => undefined);
      };
      transport.setHass({states: {}, connected: true, connection: {subscribeMessage}} as unknown as Hass);
      const stop = subscribeHa({type: 'podvoice/timer_subscribe'}, message => pushed.push(message), reason => {
        errors.push(reason);
      }, transport);
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(1999);
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toBe(3);
      expect(pushed).toEqual([{ok: true}]);
      // The first failure only: a fallback read runs once.
      expect(errors).toEqual(['not ready']);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(attempts).toBe(3);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stopped subscription is not tried again', async () => {
    vi.useFakeTimers();
    try {
      const transport = createHaTransport(createQueryClient());
      let attempts = 0;
      const subscribeMessage = () => {
        attempts += 1;
        return Promise.reject(Object.assign(new Error('not ready'), {code: 'home_assistant_error'}));
      };
      transport.setHass({states: {}, connected: true, connection: {subscribeMessage}} as unknown as Hass);
      const stop = subscribeHa({type: 'podvoice/timer_subscribe'}, () => undefined, undefined, transport);
      await vi.advanceTimersByTimeAsync(0);
      stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes a switch or select only once a screen reads it, not every one HA has', () => {
    const {client, transport, fake} = setup();
    expect(fake.hass.states['switch.model_y_defrost']).toBeTruthy();
    expect(client.getQueryData(haKeys.entity('switch.model_y_defrost'))).toBeUndefined();
    transport.watch(['switch.model_y_defrost']);
    expect(client.getQueryData(haKeys.entity('switch.model_y_defrost'))).toHaveProperty('entity_id', 'switch.model_y_defrost');
    fake.patch('switch.model_y_defrost', 'on');
    expect(client.getQueryData(haKeys.entity('switch.model_y_defrost'))).toMatchObject({state: 'on'});
  });

  it('drops an entity HA no longer has', () => {
    const {client, transport, fake} = setup();
    const rest = Object.fromEntries(Object.entries(fake.hass.states).filter(([id]) => id !== 'light.kokken_o'));
    transport.setHass({...fake.hass, states: rest});
    expect(client.getQueryData(haKeys.entity('light.kokken_o'))).toBeNull();
  });

  it('validates commands and reads HA refusals as rejected, anything else as unknown', async () => {
    const {transport, fake} = setup();
    expect(await callService({domain: 'light', service: 'turn_on', entityId: 'bad id'}, transport)).toEqual({
      ok: false, outcome: 'rejected', reason: 'invalid_command'});
    expect(fake.calls).toHaveLength(0);
    expect(await callService({domain: 'light', service: 'turn_on', entityId: 'light.kokken_o'}, transport)).toMatchObject(
      {ok: true});
    expect(fake.calls.at(-1)).toMatchObject({domain: 'light', service: 'turn_on', entityId: 'light.kokken_o'});
    expect(readFailure({code: 'not_found', message: 'x'})).toEqual({outcome: 'rejected', reason: 'x'});
    expect(readFailure({code: 3})).toEqual({outcome: 'unknown', reason: ''});
  });
});
