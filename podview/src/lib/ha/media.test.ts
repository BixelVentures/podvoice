import {describe, expect, it} from 'vitest';
import {createQueryClient} from '../query/client';
import {createFakeHass} from './ha-fixture';
import {installLastKnown, lastKnownPlayers} from './media';
import {createHaTransport} from './transport';

describe('last known players', () => {
  it('are written only when the track changes, not on every update HA sends', () => {
    const transport = createHaTransport(createQueryClient());
    lastKnownPlayers.setState({models: {}});
    const stop = installLastKnown(transport);
    const fake = createFakeHass({onChange: hass => {
      transport.setHass(hass);
    }});
    let writes = 0;
    const unsubscribe = lastKnownPlayers.subscribe(() => {
      writes += 1;
    });
    transport.setHass(fake.hass);
    const first = writes;
    expect(lastKnownPlayers.getState().models['media_player.kokkenalrum']?.title).toBeTruthy();
    // The position and the volume move; the track does not.
    fake.patch('media_player.kokkenalrum', null, {media_position: 42, volume_level: 0.3});
    fake.patch('media_player.kokkenalrum', null, {media_position: 43});
    expect(writes).toBe(first);
    fake.patch('media_player.kokkenalrum', null, {media_title: 'Towers'});
    expect(writes).toBe(first + 1);
    unsubscribe();
    stop();
  });
});
