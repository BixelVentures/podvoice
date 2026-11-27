// Find musik (design B, Hylder.dc.html): one long page of horizontal cover shelves, without tabs and without a page
// card, composed of the kit's shelf pieces (src/ui/Shelf.tsx). From the top: the 56-px search field (Spotify search
// through PodConnect, podvoice.music_search; PARITY decision 5), the grid of six quick picks (the newest of what was
// played, the AI's first picks and the top tracks), then the shelves in Hylder's order: the »AI-valgt« shelves (podvoice.music_picks: the
// PodVoice add-on chooses search ideas from the time of day, the weekday, the season, the weather and the top artists,
// and says why; the playlists are real ones found by Spotify search), PodConnect's own library reads (»For dig«: the
// top tracks, »Senest«: recently played, podvoice.music_shelf) and the old Find musik's Stemning and Humør themes as
// chip rows (podvoice.music_moods), each opening a shelf of real playlists for that theme. Every shelf is read once,
// on request, and kept in the query cache (Spotify's shared quota): nothing is read again before it is ten minutes
// old. Without the add-on only »AI-valgt« is missing, and the page says so.
// A tap starts the track (or the playlist, as a context) on the next destination (»Afspil på«), else on the room's
// speaker, through HA's media_player.play_media on that PodConnect room; the speaker playing it confirms the start.
// Last tap wins, nothing is locked while a start runs, and an unknown outcome is said once and never resent.
import {useDeferredValue, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {create, useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {AiShelf, FindItem, LibraryShelfKind, MoodGroup} from '../../lib/ha/find-music';
import {
  failureText, SHELVES, startItemOf, useFindChoices, useLibraryShelf, useMoods, usePicks, useSearch, useTheme,
} from '../../lib/ha/find-music';
import {ownMusic, START_KEY, startMusic} from '../../lib/ha/podconnect';
import {useCatalog, useEntity} from '../../lib/ha/transport';
import {Chip, Choices} from '../../ui';
import {QuickPick, SearchBox, Shelf, ShelfTile, ShelfTileSpace} from '../../ui/Shelf';
import {ScreenHeading, useStartDestination} from './Music';
import {nameOf, StartFailed} from './music-speakers';

const SHELF_ITEMS = 12;
const EMPTY = 'Ingen forslag matcher. Prøv en anden retning.';

// ---- Cards and shelves ------------------------------------------------------------------------------------------

function useStarting(): string | null {
  const start = useStore(commands.store, state => state.wishes[START_KEY]);
  return start?.phase === 'sending' || start?.phase === 'awaiting' ? (start.value as string) : null;
}

// The last start this page sent: where and what (a playlist's speaker reports its tracks, not the playlist).
const useLastStart = create<{entityId: string | null; uri: string | null}>(() => ({entityId: null, uri: null}));

// One tap, one start; a newer tap replaces it (last tap wins).
export const startItem = (destination: string | null, item: FindItem, source: string) => {
  if (!destination) return;
  useLastStart.setState({entityId: destination, uri: item.uri});
  startMusic(destination, startItemOf(item), source);
};

// What plays now from this page (G7 #14): the track the destination reports, or the last start once the speaker
// confirmed it and while it still plays the family's music there. A start that was refused or unknown marks nothing.
function usePlaying(destination: string | null): (item: FindItem) => boolean {
  const target = useEntity(destination);
  const start = useStore(commands.store, state => state.wishes[START_KEY]);
  const last = useLastStart();
  const failed = start?.phase === 'rejected' || start?.phase === 'unknown' || start?.phase === 'not_sent';
  useEffect(() => {
    if (failed) useLastStart.setState({entityId: null, uri: null});
  }, [failed]);
  const live = ownMusic(target) && target?.state === 'playing';
  const content = target?.attributes.media_content_id;
  const started = live && !start && last.entityId === destination ? last.uri : null;
  return item => live && (item.uri === content || item.uri === started);
}

const bylineOf = (item: FindItem, detail?: string) =>
  item.kind === 'playlist' ? 'Playliste' : (item.byline ?? detail ?? '');

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
  /** Keep one card's height while busy (a chosen theme's shelf). */
  hold?: boolean;
  /** Opened under its chip: the chip is the title (no heading of its own). */
  bare?: boolean;
}

const STATUS = 'text-pv-body leading-[normal] text-pv-ink-2';

function ShelfView({id, title, items, destination, why, ai = false, detail, busy, status, retry, hold = false,
  bare = false}:
  ShelfProps) {
  const starting = useStarting();
  const playing = usePlaying(destination);
  const cards = (items ?? []).slice(0, SHELF_ITEMS);
  const source = `shelf:${id}`;
  return (
    <>
    <Shelf id={id} title={title} ai={ai} why={why} bare={bare} {...(status ? {status} : {})} retry={retry}
      {...(busy === undefined ? {} : {busy})}>
      {described => (
        <>
          {cards.map(item => (
            // An AI card is described by the shelf's badge and reason (»AI-valgt · Fordi …«).
            <ShelfTile key={item.uri} kind={item.kind} title={item.name} ai={ai}
              line={ai ? 'AI-valgt' : bylineOf(item, detail)} cover={item.artwork}
              label={`Afspil ${[item.name, bylineOf(item, detail)].filter(Boolean).join(' · ')}`}
              describedBy={described} busy={starting === item.uri} playing={playing(item)}
              disabled={!destination}
              onPress={() => { startItem(destination, item, source); }} />
          ))}
          {hold && busy && !cards.length ? <ShelfTileSpace /> : null}
        </>
      )}
    </Shelf>
    <StartFailed source={source} />
    </>
  );
}

// The six quick picks (Hylder): what was played last, the AI's first pick for the moment and the time of day, and
// the top tracks; each once, in that order, from the shelves the page reads anyway (no extra Spotify call).
function QuickPicks({sources, destination}: {sources: {items: readonly FindItem[] | undefined; ai?: string}[];
  destination: string | null}) {
  const starting = useStarting();
  const playing = usePlaying(destination);
  const rows: {item: FindItem; ai?: string}[] = [];
  const queues = sources.map(source => [...(source.items ?? [])]);
  for (let round = 0; rows.length < 6 && queues.some(queue => queue.length); round++) {
    queues.forEach((queue, index) => {
      while (rows.length < 6 && queue.length) {
        const item = queue.shift();
        if (!item || rows.some(row => row.item.uri === item.uri)) continue;
        const ai = sources[index]?.ai;
        rows.push(ai ? {item, ai} : {item});
        break;
      }
    });
  }
  if (!rows.length) return null;
  return (
    <>
    <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Hurtige valg">
      {rows.map(({item, ai}) => (
        <QuickPick key={item.uri} title={item.name} badge={ai ?? ''} cover={item.artwork}
          label={`Afspil ${[item.name, ai ?? bylineOf(item)].filter(Boolean).join(' · ')}`}
          busy={starting === item.uri} playing={playing(item)} disabled={!destination}
          onPress={() => { startItem(destination, item, 'quick'); }} />
      ))}
    </div>
    <StartFailed source="quick" />
    </>
  );
}

function LibraryShelf({shelf, read, destination}: {shelf: LibraryShelfKind; read: ReturnType<typeof useLibraryShelf>;
  destination: string | null}) {
  const {data, isError, isPending, refetch} = read;
  return (
    <ShelfView id={shelf.kind} title={shelf.label} why={shelf.why} items={data} destination={destination}
      detail={shelf.detail} busy={isPending} status={isError ? 'Forslagene kunne ikke hentes.' : ''}
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
  const status = isError ? failureText(error) : data?.length === 0 && !isFetching ? EMPTY : '';
  return (
    <>
      <SearchBox value={text} onChange={setText} onSubmit={() => { submit(text); }} onClear={clear}
        label="Søg efter en sang" placeholder="Søg efter en sang" />
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
      busy={isFetching} status={status} hold bare retry={isError ? () => void refetch() : undefined} />
  );
}

// The scrolling ancestor of a node: the screen column in the stack.
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const {overflowY} = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
}

function Moods({groups, destination}: {groups: readonly MoodGroup[]; destination: string | null}) {
  const chosen = useFindChoices(state => state.theme);
  const choose = useFindChoices(state => state.choose);
  // The chip answers in the tap's own frame; the shelf it opens follows in a deferred render, so mounting a shelf
  // never holds up the choice.
  const shown = useDeferredValue(chosen);
  // One theme is open at a time. Choosing a Humør chip closes an open Stemning shelf above it, which would pull the
  // chip away under the finger; the tapped group stays where it was (WebKit has no CSS scroll anchoring).
  const anchor = useRef<{node: HTMLElement; top: number} | null>(null);
  const sections = useRef(new Map<string, HTMLElement>());
  const pick = (groupId: string, id: string) => {
    const node = sections.current.get(groupId);
    anchor.current = node ? {node, top: node.getBoundingClientRect().top} : null;
    choose(id);
  };
  useLayoutEffect(() => {
    const held = anchor.current;
    anchor.current = null;
    if (!held?.node.isConnected) return;
    const shift = held.node.getBoundingClientRect().top - held.top;
    const scroller = scrollParent(held.node);
    if (shift && scroller) scroller.scrollTop += shift;
  }, [shown]);
  return groups.map(group => {
    const picked = group.themes.find(theme => theme.id === chosen);
    const open = group.themes.find(theme => theme.id === shown);
    return (
      <section key={group.id} className="flex min-w-0 flex-col gap-2.5" aria-labelledby={`find-group-${group.id}`}
        ref={node => {
          if (node) sections.current.set(group.id, node);
          else sections.current.delete(group.id);
        }}>
        <h2 id={`find-group-${group.id}`} className="text-[22px] leading-[1.2] font-extrabold tracking-[-0.4px]">
          {group.label}
        </h2>
        <Choices
          aria-label={group.label}
          className="flex flex-wrap gap-pv-s1"
          value={picked?.id ?? null}
          onChange={id => {
            pick(group.id, id);
          }}
          onClear={() => {
            if (picked) pick(group.id, picked.id);
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
  const destination = useStartDestination();
  const target = useEntity(destination);
  const {weather} = useCatalog();
  const picks = usePicks(true, weather[0] ?? null);
  const moods = useMoods(true);
  const ai = (id: AiShelf['id']) => picks.data?.find(shelf => shelf.id === id);
  const top = useLibraryShelf(SHELVES[0]);
  const recent = useLibraryShelf(SHELVES[1]);
  return (
    // No page card (PARITY decision 2): the shelves stand on the page, 28 apart, as on Hylder.
    <section id="find-view" className="flex flex-col gap-7 pb-6" aria-labelledby="find-title">
      <ScreenHeading id="find-title" title="Find musik"
        line={destination ? `Næste afspilning: ${nameOf(target, destination)}` : 'Ingen højttaler i rummet'} />
      <Search destination={destination} />
      <QuickPicks destination={destination} sources={[
        {items: recent.data},
        {items: ai('ai_moment')?.items, ai: 'AI-valgt'},
        {items: top.data},
        {items: ai('ai_daypart')?.items, ai: 'AI-valgt'},
      ]} />
      {picks.isError ? (
        <p className={STATUS} role="status">
          {failureText(picks.error)}
        </p>
      ) : null}
      <AiShelfView shelf={ai('ai_moment')} destination={destination} />
      <LibraryShelf shelf={SHELVES[0]} read={top} destination={destination} />
      <AiShelfView shelf={ai('ai_artist')} destination={destination} />
      <LibraryShelf shelf={SHELVES[1]} read={recent} destination={destination} />
      <AiShelfView shelf={ai('ai_daypart')} destination={destination} />
      <AiShelfView shelf={ai('ai_season')} destination={destination} />
      {moods.data ? <Moods groups={moods.data} destination={destination} /> : null}
    </section>
  );
}
