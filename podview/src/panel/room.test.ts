import {describe, expect, it} from 'vitest';
import type {Room} from '../lib/ha/catalog';
import {mainRoom, pickRoom} from './room';

const room = (id: string, name: string, lights: number, players: number): Room => ({
  id,
  name,
  lights: Array.from({length: lights}, (_, n) => `light.${id}_${String(n)}`),
  players: Array.from({length: players}, (_, n) => `media_player.${id}_${String(n)}`),
});

// The rooms HA Green has (sorted by name, as the catalog sorts them): two bedrooms with only a speaker sort first.
const GREEN = [
  room('fridas', "Frida's Værelse", 0, 1),
  room('kokkenalrum', 'Køkkenalrum', 3, 1),
  room('stue', 'Stue', 7, 0),
  room('svends', "Svend's Værelse", 0, 1),
];

describe('the room the wall opens in', () => {
  it('without a setting: the room with both speaker and lights, never a bedroom by alphabet', () => {
    expect(mainRoom(GREEN)?.id).toBe('kokkenalrum');
    expect(pickRoom(GREEN, null, null, null)?.id).toBe('kokkenalrum');
  });

  it('is the same whatever order the rooms come in', () => {
    expect(mainRoom([...GREEN].reverse())?.id).toBe('kokkenalrum');
  });

  it('without a room that has both: the most controls, then the name', () => {
    expect(mainRoom([room('a', 'Bad', 1, 0), room('b', 'Alrum', 2, 0)])?.id).toBe('b');
    expect(mainRoom([room('b', 'Bryggers', 1, 0), room('a', 'Alrum', 0, 1)])?.id).toBe('a');
    expect(mainRoom([])).toBeNull();
  });

  it('a tapped chip, the URL and the integration\'s default area win in that order; unknown ids fall through', () => {
    expect(pickRoom(GREEN, null, null, 'stue')?.id).toBe('stue');
    expect(pickRoom(GREEN, null, 'svends', 'stue')?.id).toBe('svends');
    expect(pickRoom(GREEN, 'fridas', 'svends', 'stue')?.id).toBe('fridas');
    expect(pickRoom(GREEN, null, 'gone', 'also-gone')?.id).toBe('kokkenalrum');
  });
});
