// Find musik (design B): one long page of horizontal cover shelves, without tabs on top. From the top: a search
// field (Spotify search through PodConnect, podvoice.music_search), the »AI-valgt« shelves (podvoice.music_picks: the
// PodVoice add-on chooses search ideas from the time of day, the weekday, the season, the weather and the top artists,
// and says why; the playlists are real ones found by Spotify search), PodConnect's own library reads (»For dig«: the
// top tracks, »Senest«: recently played, podvoice.music_shelf) and the old Find musik's Stemning and Humør themes as
// chip rows (podvoice.music_moods), each opening a shelf of real playlists for that theme. Every shelf is read once,
// on request, and kept in the query cache (Spotify's shared quota): nothing is read again before it is ten minutes
// old. Without the add-on only »AI-valgt« is missing, and the page says so.
// A tap starts the track (or the playlist, as a context) on the next destination (»Afspil på«), else on the room's
// speaker, through HA's media_player.play_media on that PodConnect room; the speaker playing it confirms the start.
// Last tap wins, nothing is locked while a start runs, and an unknown outcome is said once and never resent.
import {useQuery} from '@tanstack/react-query';
import {motion, useReducedMotion} from 'motion/react';
import {useState} from 'react';
import type {SyntheticEvent} from 'react';
import {Input, SearchField} from 'react-aria-components';
import {z} from 'zod';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {AiShelf, FindItem, MoodGroup} from '../../lib/ha/find-music';
import {failureText, useFindChoices, useMoods, usePicks, useSearch, useTheme} from '../../lib/ha/find-music';
import {roomPlayer} from '../../lib/ha/media';
import {music, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import {haKeys, serviceResponse, useCatalog, useEntities, useEntity} from '../../lib/ha/transport';
import {KitButton} from '../../lib/ui/KitButton';
import {useRoom} from '../room';
import {BUTTON, icon, Notice, wishNotice} from '../ui';
import './find-music.css';
import {nameOf} from './music-speakers';

const artwork = z.union([z.string(), z.looseObject({url: z.string()}), z.null()]).optional();
const tracksSchema = z.looseObject({
  ok: z.literal(true),
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
const SHELF_ITEMS = 12;
const EMPTY = 'Ingen forslag matcher. Prøv en anden retning.';
const coverOf = (track: Track) => {
  const url = typeof track.artwork === 'string' ? track.artwork : track.artwork?.url;
  return url?.startsWith('https://') ? url : null;
};

export const shelfKey = (kind: string) => [...haKeys.read, 'shelf', kind] as const;

function useShelf(shelf: Shelf) {
  // Find musik is built only on a visit (or as the finger lands on its control: bounded mounting in nav.ts), so the
  // shelves are read from the moment it exists and drawn before the slide: no Spotify call for a screen nobody opens.
  return useQuery({
    queryKey: shelfKey(shelf.kind),
    staleTime: SHELF_STALE_MS,
    gcTime: Infinity,
    queryFn: async (): Promise<FindItem[]> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'music_shelf', data: {shelf: shelf.service}, returnResponse: true},
        tracksSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      // The same track twice on a shelf is one card.
      return result.value.tracks
        .filter((track, index, all) => all.findIndex(row => row.uri === track.uri) === index)
        .map(track => ({kind: 'track', uri: track.uri, name: track.name ?? '', byline: track.artist ?? null,
          artwork: coverOf(track)}));
    },
  });
}

// ---- Cards and shelves ------------------------------------------------------------------------------------------

// A cover fades in (opacity only, find-music.css) once it is decoded; until then the tile's own surface shows.
function Cover({src}: {src: string | null}) {
  const [ready, setReady] = useState(false);
  return (
    <span className="find-art">
      <img src={src ?? icon('music-note-beamed')} alt="" data-ready={ready || !src ? '' : undefined} onLoad={() => {
        setReady(true);
      }} />
    </span>
  );
}

function Card({item, ai, detail, destination}: {item: FindItem; ai?: string | undefined;
  detail?: string | undefined; destination: string | null}) {
  const start = useStore(commands.store, state => state.wishes[START_KEY]);
  const starting = start?.phase === 'sending' || start?.phase === 'awaiting' ? (start.value as string) : null;
  const byline = item.kind === 'playlist' ? 'Playliste' : (item.byline ?? detail ?? '');
  return (
    <KitButton
      className="find-tile find-slot"
      data-kind={item.kind}
      aria-label={`Afspil ${[item.name, byline].filter(Boolean).join(' · ')}`}
      aria-description={ai ? `AI-valgt. ${ai}` : undefined}
      aria-busy={starting === item.uri}
      isDisabled={!destination}
      onPress={() => {
        // One tap, one start; a newer tap replaces it (last tap wins).
        if (destination) music.start(destination, item.uri, item.kind === 'playlist' ? 'playlist' : 'music');
      }}
    >
      <Cover src={item.artwork} />
      <strong>{item.name}</strong>
      {ai ? <span className="find-ai-line">AI-valgt</span> : <span>{byline}</span>}
    </KitButton>
  );
}

interface ShelfProps {
  id: string;
  title: string;
  items: readonly FindItem[] | undefined;
  destination: string | null;
  why?: string | undefined;
  ai?: boolean;
  detail?: string | undefined;
  busy?: boolean;
  status?: string;
  retry?: (() => void) | undefined;
}

function ShelfView({id, title, items, destination, why, ai, detail, busy, status, retry}: ShelfProps) {
  const reduced = useReducedMotion();
  const cards = (items ?? []).slice(0, SHELF_ITEMS);
  return (
    <motion.section
      className="find-shelf find-layer"
      aria-labelledby={`find-${id}`}
      initial={reduced ? false : {opacity: 0}}
      animate={{opacity: 1}}
      transition={{duration: 0.16, ease: [0.2, 0, 0, 1]}}
    >
      <div className="find-shelf-head">
        <div className="find-shelf-title">
          <h2 id={`find-${id}`}>{title}</h2>
          {ai ? <span className="find-ai-badge">AI-valgt</span> : null}
        </div>
        {why ? <p className="find-why">{why}</p> : null}
      </div>
      {status ? (
        <p className="find-empty" role="status">
          {status}{' '}
          {retry ? (
            <KitButton className="pv-panel-chip" onPress={retry}>
              Prøv igen
            </KitButton>
          ) : null}
        </p>
      ) : null}
      <div className="find-shelf-row" role="group" aria-label={title} aria-busy={busy}>
        {cards.map(item => (
          <Card key={item.uri} item={item} ai={ai ? why : undefined} detail={detail} destination={destination} />
        ))}
      </div>
    </motion.section>
  );
}

function LibraryShelf({shelf, destination}: {shelf: Shelf; destination: string | null}) {
  const {data, isError, isPending, refetch} = useShelf(shelf);
  return (
    <ShelfView id={shelf.kind} title={shelf.label} items={data} destination={destination} detail={shelf.detail}
      busy={isPending} status={isError ? 'Forslagene kunne ikke hentes.' : ''}
      retry={isError ? () => void refetch() : undefined} />
  );
}

// ---- Search ------------------------------------------------------------------------------------------------------

function Search({destination}: {destination: string | null}) {
  const [text, setText] = useState('');
  const query = useFindChoices(state => state.query);
  const submit = useFindChoices(state => state.submit);
  const clear = useFindChoices(state => state.clear);
  const {data, error, isError, isFetching} = useSearch(query);
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    submit(text);
  };
  const status = isError ? failureText(error) : data?.length === 0 && !isFetching ? EMPTY : '';
  return (
    <>
      <form className="find-search" role="search" aria-label="Søg efter musik" onSubmit={onSubmit}>
        <SearchField className="find-search-field" aria-label="Søg efter en sang" value={text} onChange={setText}
          onClear={clear}>
          <Input placeholder="Søg efter en sang" maxLength={160} />
        </SearchField>
        <KitButton type="submit" className={BUTTON} isDisabled={!text.trim()}>
          Søg
        </KitButton>
      </form>
      {query ? (
        <ShelfView id="search" title="Søgeresultater" items={isError ? [] : data} destination={destination}
          busy={isFetching} status={status} />
      ) : null}
    </>
  );
}

// ---- Stemning and Humør ------------------------------------------------------------------------------------------

function ThemeShelf({theme, destination}: {theme: {id: string; title: string}; destination: string | null}) {
  const {data, error, isError, isFetching, refetch} = useTheme(theme.id);
  const status = isError ? failureText(error) : data?.length === 0 && !isFetching ? EMPTY : '';
  return (
    <ShelfView id={`theme-${theme.id}`} title={theme.title} items={isError ? [] : data} destination={destination}
      busy={isFetching} status={status} retry={isError ? () => void refetch() : undefined} />
  );
}

function Moods({groups, destination}: {groups: readonly MoodGroup[]; destination: string | null}) {
  const chosen = useFindChoices(state => state.theme);
  const choose = useFindChoices(state => state.choose);
  return groups.map(group => {
    const open = group.themes.find(theme => theme.id === chosen);
    return (
      <section key={group.id} className="find-shelf" aria-labelledby={`find-group-${group.id}`}>
        <div className="find-shelf-head">
          <div className="find-shelf-title">
            <h2 id={`find-group-${group.id}`}>{group.label}</h2>
          </div>
        </div>
        <div className="pv-panel-chips find-chips" role="radiogroup" aria-label={group.label}>
          {group.themes.map(theme => (
            <KitButton key={theme.id} role="radio" aria-checked={theme.id === chosen} className="pv-panel-chip"
              onPress={() => {
                choose(theme.id);
              }}>
              {theme.title}
            </KitButton>
          ))}
        </div>
        {open ? <ThemeShelf key={open.id} theme={open} destination={destination} /> : null}
      </section>
    );
  });
}

// ---- The page ----------------------------------------------------------------------------------------------------

function AiShelfView({shelf, destination}: {shelf: AiShelf | undefined; destination: string | null}) {
  if (!shelf) return null;
  return (
    <ShelfView id={shelf.id} title={shelf.title} why={shelf.why} ai items={shelf.items} destination={destination} />
  );
}

export function FindMusicScreen() {
  const {room} = useRoom();
  const states = useEntities(room?.players ?? []);
  const next = useSpeakers(state => state.nextDestination);
  const destination = next ?? roomPlayer(states)?.entity_id ?? room?.players[0] ?? null;
  const target = useEntity(destination);
  const start = useStore(commands.store, state => state.wishes[START_KEY]);
  const {weather} = useCatalog();
  const picks = usePicks(true, weather[0] ?? null);
  const moods = useMoods(true);
  const ai = (id: AiShelf['id']) => picks.data?.find(shelf => shelf.id === id);
  return (
    <section id="find-view" className="response-widget find-musik" aria-labelledby="find-title">
      <header className="response-heading">
        <div>
          <h1 id="find-title">Find musik</h1>
          <p>{destination ? `Næste afspilning: ${nameOf(target, destination)}` : 'Ingen højttaler i rummet'}</p>
        </div>
      </header>
      <Search destination={destination} />
      {picks.isError ? (
        <p className="screen-explanation find-ai-status" role="status">
          {failureText(picks.error)}
        </p>
      ) : null}
      <AiShelfView shelf={ai('ai_moment')} destination={destination} />
      <LibraryShelf shelf={SHELVES[0]} destination={destination} />
      <AiShelfView shelf={ai('ai_artist')} destination={destination} />
      <LibraryShelf shelf={SHELVES[1]} destination={destination} />
      <AiShelfView shelf={ai('ai_daypart')} destination={destination} />
      {moods.data ? <Moods groups={moods.data} destination={destination} /> : null}
      <AiShelfView shelf={ai('ai_season')} destination={destination} />
      <Notice text={wishNotice(start)} />
    </section>
  );
}
