// Find musik (design B): shelves that scroll, without tabs on top. On the panel the shelves are what HA can give
// without the PodVoice add-on: PodConnect's own library reads of the Spotify account (»For dig«: the top tracks,
// »Senest«: recently played). They are read once and kept in the query cache (Spotify's API limits): no shelf is
// read again before it is ten minutes old. The add-on's AI picks (»AI-valgt«, Stemning, Humør) are not reachable
// from HA and are not shown. A tap starts the track on the next destination (»Afspil på«), else on the room's
// speaker, through HA's media_player.play_media on that PodConnect room; the speaker playing it confirms the start.
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import {roomPlayer} from '../../lib/ha/media';
import {music, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import {haKeys, serviceResponse, useEntities, useEntity} from '../../lib/ha/transport';
import {KitButton} from '../../lib/ui/KitButton';
import {useRoom} from '../room';
import {icon, Notice, wishNotice} from '../ui';
import {nameOf} from './music-speakers';

const artwork = z.union([z.string(), z.looseObject({url: z.string()}), z.null()]).optional();
const tracksSchema = z.looseObject({
  tracks: z
    .array(
      z.looseObject({
        name: z.string().max(256).nullable(),
        artist: z.string().max(512).nullable().optional(),
        uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/),
        artwork,
      }),
    )
    .max(50),
});
type Track = z.infer<typeof tracksSchema>['tracks'][number];

const SHELVES = [
  {kind: 'top', label: 'For dig', service: 'top_tracks', detail: 'Dine topsange'},
  {kind: 'recent', label: 'Senest', service: 'recently_played', detail: ''},
] as const;
type Shelf = (typeof SHELVES)[number];

const SHELF_STALE_MS = 10 * 60_000;
const coverOf = (track: Track) => {
  const url = typeof track.artwork === 'string' ? track.artwork : track.artwork?.url;
  return url?.startsWith('https://') ? url : null;
};

export const shelfKey = (kind: string) => [...haKeys.read, 'shelf', kind] as const;

function useShelf(shelf: Shelf) {
  return useQuery({
    queryKey: shelfKey(shelf.kind),
    staleTime: SHELF_STALE_MS,
    gcTime: Infinity,
    queryFn: async () => {
      const result = await serviceResponse(
        {domain: 'podconnect', service: shelf.service, data: {}, returnResponse: true},
        tracksSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      // The same track twice on a shelf is one card.
      return result.value.tracks.filter((track, index, all) => all.findIndex(row => row.uri === track.uri) === index);
    },
  });
}

function ShelfRow({shelf, destination}: {shelf: Shelf; destination: string | null}) {
  const {data, isError, isPending, refetch} = useShelf(shelf);
  const start = useStore(commands.store, state => state.wishes[START_KEY]);
  const starting = start?.phase === 'sending' || start?.phase === 'awaiting' ? (start.value as string) : null;
  const cards = (data ?? []).slice(0, 12);
  return (
    <section className="pv-panel-shelf" aria-labelledby={`shelf-${shelf.kind}`}>
      <h2 id={`shelf-${shelf.kind}`}>{shelf.label}</h2>
      {isError ? (
        <p className="screen-explanation" role="status">
          Forslagene kunne ikke hentes.{' '}
          <KitButton className="pv-panel-chip" onPress={() => void refetch()}>
            Prøv igen
          </KitButton>
        </p>
      ) : null}
      <div className="music-shelf" role="group" aria-label={shelf.label} aria-busy={isPending}>
        {cards.map(track => {
          const name = track.name ?? '';
          const cover = coverOf(track);
          return (
            <KitButton
              key={track.uri}
              className="pv-kit pv-kit-listrow pv-row pv-panel-card"
              data-kit="listrow"
              aria-label={`Afspil ${[name, track.artist].filter(Boolean).join(' · ')}`}
              aria-busy={starting === track.uri}
              isDisabled={!destination}
              onPress={() => {
                if (destination) music.start(destination, track.uri);
              }}
            >
              <img src={cover ?? icon('music-note-beamed')} alt="" />
              <span>
                <strong>{name}</strong>
                <small>{track.artist ?? shelf.detail}</small>
              </span>
            </KitButton>
          );
        })}
      </div>
    </section>
  );
}

export function FindMusicScreen() {
  const {room} = useRoom();
  const states = useEntities(room?.players ?? []);
  const next = useSpeakers(state => state.nextDestination);
  const destination = next ?? roomPlayer(states)?.entity_id ?? room?.players[0] ?? null;
  const target = useEntity(destination);
  const start = useStore(commands.store, state => state.wishes[START_KEY]);
  return (
    <section id="find-view" className="response-widget" aria-labelledby="find-title">
      <header className="response-heading">
        <div>
          <h1 id="find-title">Find musik</h1>
          <p>{destination ? `Næste afspilning: ${nameOf(target, destination)}` : 'Ingen højttaler i rummet'}</p>
        </div>
      </header>
      {SHELVES.map(shelf => (
        <ShelfRow key={shelf.kind} shelf={shelf} destination={destination} />
      ))}
      <Notice text={wishNotice(start)} />
      <p className="screen-explanation">
        AI-valgte forslag, Stemning og Humør kommer fra PodVoice-add-on&apos;et og vises ikke her.
      </p>
    </section>
  );
}
