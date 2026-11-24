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
import {useId, useState} from 'react';
import type {SyntheticEvent} from 'react';
import {Button as AriaButton, Input, SearchField} from 'react-aria-components';
import {z} from 'zod';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {AiShelf, FindItem, MoodGroup} from '../../lib/ha/find-music';
import {
  failureText, FIND_GC_MS, useFindChoices, useMoods, usePicks, useSearch, useTheme,
} from '../../lib/ha/find-music';
import {roomPlayer} from '../../lib/ha/media';
import {music, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import {haKeys, serviceResponse, useCatalog, useEntities, useEntity} from '../../lib/ha/transport';
import {TRANSITION} from '../../lib/motion/tokens';
import {Button, Chip, Choices, cx, iconUrl, pressable} from '../../ui';
import {useRoom} from '../room';
import {Notice, wishNotice} from '../ui';
import {ScreenHeading, SCREEN} from './Music';
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
    gcTime: Math.max(SHELF_STALE_MS, FIND_GC_MS),
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

// A cover fades in (opacity only) once it is decoded; until then the tile's own surface shows. A tile whose start is
// on its way dims its cover.
function Cover({src}: {src: string | null}) {
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();
  return (
    <span className={cx('relative block size-[136px] flex-none overflow-hidden rounded-[16px] bg-pv-surface-2',
      '[transform:translateZ(0)] group-data-[busy]/tile:opacity-60')}>
      <motion.img
        className="pointer-events-none block size-full object-cover"
        src={src ?? iconUrl('music-note-beamed')}
        alt=""
        loading="lazy"
        decoding="async"
        initial={false}
        animate={{opacity: ready || !src ? 1 : 0}}
        transition={reduced ? TRANSITION.reduced : {duration: 0.16, ease: [0.2, 0, 0, 1]}}
        onLoad={() => {
          setReady(true);
        }}
      />
    </span>
  );
}

const LINE = 'truncate text-[14px] leading-[normal] text-pv-ink-3';

function Card({item, ai, describedBy, detail, destination}: {item: FindItem; ai: boolean;
  describedBy: string | undefined; detail?: string | undefined; destination: string | null}) {
  const start = useStore(commands.store, state => state.wishes[START_KEY]);
  const starting = start?.phase === 'sending' || start?.phase === 'awaiting' ? (start.value as string) : null;
  const byline = item.kind === 'playlist' ? 'Playliste' : (item.byline ?? detail ?? '');
  return (
    <AriaButton
      className={cx(pressable, 'group/tile flex w-[136px] flex-none snap-start flex-col gap-2 text-left text-pv-ink')}
      data-kind={item.kind}
      data-busy={starting === item.uri ? 'true' : undefined}
      aria-label={`Afspil ${[item.name, byline].filter(Boolean).join(' · ')}`}
      {...(describedBy ? {'aria-describedby': describedBy} : {})}
      isDisabled={!destination}
      onPress={() => {
        // One tap, one start; a newer tap replaces it (last tap wins).
        if (destination) music.start(destination, item.uri, item.kind === 'playlist' ? 'playlist' : 'music');
      }}
    >
      <Cover src={item.artwork} />
      <strong className="truncate text-[16px] leading-[1.2] font-bold">{item.name}</strong>
      <span className={cx(LINE, '-mt-1', ai && 'font-bold')}>{ai ? 'AI-valgt' : byline}</span>
    </AriaButton>
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

const SHELF = 'flex min-w-0 flex-col gap-2.5';
const SHELF_TITLE = 'text-[22px] leading-[1.2] font-extrabold tracking-[-0.4px]';
const STATUS = 'text-pv-body leading-[normal] text-pv-ink-2';

function ShelfView({id, title, items, destination, why, ai = false, detail, busy, status, retry}: ShelfProps) {
  const reduced = useReducedMotion();
  // An AI card is described by the shelf's badge and reason (»AI-valgt · Fordi …«), read after the card's name.
  const uid = useId();
  const described = ai && why ? `${uid}-badge ${uid}-why` : undefined;
  const cards = (items ?? []).slice(0, SHELF_ITEMS);
  return (
    <motion.section
      className={cx(SHELF, '[transform:translateZ(0)]')}
      aria-labelledby={`find-${id}`}
      initial={reduced ? false : {opacity: 0}}
      animate={{opacity: 1}}
      transition={{duration: 0.16, ease: [0.2, 0, 0, 1]}}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2.5">
          <h2 id={`find-${id}`} className={SHELF_TITLE}>{title}</h2>
          {ai ? (
            <span id={`${uid}-badge`} className="flex-none rounded-[11px] bg-pv-ai-tint px-[9px] py-[3px] text-[14px]
              leading-[normal] font-bold text-pv-ai-ink" data-badge="ai">
              AI-valgt
            </span>
          ) : null}
        </div>
        {why ? <p id={`${uid}-why`} className="text-pv-meta leading-[1.35] text-pv-ink-2">{why}</p> : null}
      </div>
      {status ? (
        <p className={STATUS} role="status">
          {status}{' '}
          {retry ? (
            <Button size="chip" onPress={retry}>
              Prøv igen
            </Button>
          ) : null}
        </p>
      ) : null}
      <div className="flex gap-pv-s2 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-mandatory
        [scrollbar-width:none] empty:hidden [&::-webkit-scrollbar]:hidden" role="group" aria-label={title}
        aria-busy={busy}>
        {cards.map(item => (
          <Card key={item.uri} item={item} ai={ai} describedBy={described} detail={detail}
            destination={destination} />
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
      <form className="flex items-center gap-pv-s2" role="search" aria-label="Søg efter musik" onSubmit={onSubmit}>
        <SearchField className="min-w-0 flex-1" aria-label="Søg efter en sang" value={text} onChange={setText}
          onClear={clear}>
          <Input className="min-h-pv-hit w-full rounded-pv-pill border border-pv-line bg-pv-surface-2 px-pv-s3
            text-pv-body text-pv-ink outline-none [&::-webkit-search-cancel-button]:hidden"
            placeholder="Søg efter en sang" maxLength={160} />
        </SearchField>
        <Button type="submit" isDisabled={!text.trim()}>
          Søg
        </Button>
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
      <section key={group.id} className={SHELF} aria-labelledby={`find-group-${group.id}`}>
        <h2 id={`find-group-${group.id}`} className={SHELF_TITLE}>{group.label}</h2>
        <Choices
          aria-label={group.label}
          className="flex flex-wrap gap-pv-s1"
          value={open?.id ?? null}
          onChange={choose}
          onClear={() => {
            if (open) choose(open.id);
          }}
        >
          {group.themes.map(theme => (
            <Chip key={theme.id} id={theme.id}>
              {theme.title}
            </Chip>
          ))}
        </Choices>
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
    <section id="find-view" className={cx(SCREEN, 'gap-7')} aria-labelledby="find-title">
      <ScreenHeading id="find-title" title="Find musik"
        line={destination ? `Næste afspilning: ${nameOf(target, destination)}` : 'Ingen højttaler i rummet'} />
      <Search destination={destination} />
      {picks.isError ? (
        <p className={STATUS} role="status">
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
