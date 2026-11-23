import {QueryObserver} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {describe, expect, it, vi} from 'vitest';
import {createQueryClient} from '../query/client';
import {createFakeHass} from './ha-fixture';
import {callService, createHaTransport, haKeys, readFailure} from './transport';
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
    expect(catalog?.rooms[0]).toMatchObject({lights: ['light.kokken_loft', 'light.kokken_o'],
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
