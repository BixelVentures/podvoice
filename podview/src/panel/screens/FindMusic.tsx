// Find musik (design B, Hylder.dc.html): one long page of horizontal cover shelves, without tabs and without a page
// card, composed of the kit's shelf pieces (src/ui/Shelf.tsx). From the top: the 56-px search field (Spotify search
// through PodConnect, podvoice.music_search; PARITY decision 5), the grid of six quick picks (the newest of what was
// played, the AI's first picks and the top tracks), then the shelves in Hylder's order: the »AI-valgt« shelves (podvoice.music_picks: the
// PodVoice add-on chooses search ideas from the time of day, the weekday, the season, the weather and the top artists,
// and says why; the playlists are real ones found by Spotify search), PodConnect's own library reads (»For dig«: the
// top tracks, »Senest«: recently played, podvoice.music_shelf) and »Hvad skal musikken til?« (Find musik D,
// Stemning.dc.html): six activity tiles, each opening three real playlists for that activity, and the wall's last
// activities (»Jeres seneste stemninger«, podvoice.music_activities). Every shelf is read once,
// on request, and kept in the query cache (Spotify's shared quota): nothing is read again before it is ten minutes
// old. Without the add-on only »AI-valgt« is missing, and the page says so.
// A tap starts the track (or the playlist, as a context) on the next destination (»Afspil på«), else on the room's
// speaker, through HA's media_player.play_media on that PodConnect room; the speaker playing it confirms the start.
// Last tap wins, nothing is locked while a start runs, and an unknown outcome is said once and never resent.
import {useQueryClient} from '@tanstack/react-query';
import {useEffect, useRef, useState} from 'react';
import {useReducedMotion} from 'motion/react';
import {create, useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {ActivityId} from '../../lib/format/activities';
import {ACTIVITIES, ACTIVITY_COLOUR, activityContext, activityTitle, activityWhen} from '../../lib/format/activities';
import {useNow, useRefreshAt} from '../../lib/hooks/clock';
import type {AiShelf, FindItem, LibraryShelfKind} from '../../lib/ha/find-music';
import {
  failureText, historyKey, recordActivity, SHELVES, useActivity, useActivityHistory, useFindChoices,
  useLibraryShelf, usePicks, useSearch,
} from '../../lib/ha/find-music';
import {roomPlayer} from '../../lib/ha/media';
import {music, ownMusic, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import {useCatalog, useEntities, useEntity} from '../../lib/ha/transport';
import {ActivityCard, ActivityHistoryRow, ActivityResults, ActivityTile} from '../../ui/Activity';
import {QuickPick, SearchBox, Shelf, ShelfTile, ShelfTileSpace} from '../../ui/Shelf';
import {useRoom} from '../room';
import {Notice, wishNotice} from '../ui';
import {ScreenHeading} from './Music';
import {nameOf} from './music-speakers';

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
const startItem = (destination: string | null, item: FindItem) => {
  if (!destination) return;
  useLastStart.setState({entityId: destination, uri: item.uri});
  music.start(destination, item.uri, item.kind === 'playlist' ? 'playlist' : 'music');
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
}

const STATUS = 'text-pv-body leading-[normal] text-pv-ink-2';

function ShelfView({id, title, items, destination, why, ai = false, detail, busy, status, retry, hold = false}:
  ShelfProps) {
  const starting = useStarting();
  const playing = usePlaying(destination);
  const cards = (items ?? []).slice(0, SHELF_ITEMS);
  return (
    <Shelf id={id} title={title} ai={ai} why={why} {...(status ? {status} : {})} retry={retry}
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
              onPress={() => { startItem(destination, item); }} />
          ))}
          {hold && busy && !cards.length ? <ShelfTileSpace /> : null}
        </>
      )}
    </Shelf>
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
    <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Hurtige valg">
      {rows.map(({item, ai}) => (
        <QuickPick key={item.uri} title={item.name} badge={ai ?? ''} cover={item.artwork}
          label={`Afspil ${[item.name, ai ?? bylineOf(item)].filter(Boolean).join(' · ')}`}
          busy={starting === item.uri} playing={playing(item)} disabled={!destination}
          onPress={() => { startItem(destination, item); }} />
      ))}
    </div>
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

// ---- Hvad skal musikken til? ------------------------------------------------------------------------------------

const RESULTS = 3;
const HOUR_MS = 3_600_000;
const SECTION_TITLE = 'text-[22px] leading-[1.2] font-extrabold tracking-[-0.4px]';

function ActivityShelf({activity, hint, destination}: {activity: ActivityId; hint: string | undefined;
  destination: string | null}) {
  const {data, error, isError, isPending, refetch} = useActivity(activity);
  const starting = useStarting();
  const playing = usePlaying(destination);
  const title = `Til ${activityTitle(activity).toLocaleLowerCase('da')}`
    + (hint && !hint.startsWith('Nu') ? `, ${hint.toLocaleLowerCase('da')}` : '');
  const items = isError ? [] : (data ?? []).slice(0, RESULTS);
  const status = isError ? failureText(error) : data?.length === 0 ? EMPTY : '';
  return (
    <ActivityResults id={activity} title={title} busy={isPending} status={status}
      retry={isError ? () => void refetch() : undefined}>
      {items.map(item => (
        <ActivityCard key={item.uri} title={item.name} line={bylineOf(item)} cover={item.artwork}
          label={`Afspil ${item.name} · ${bylineOf(item)}`} busy={starting === item.uri} playing={playing(item)}
          disabled={!destination} onPress={() => { startItem(destination, item); }} />
      ))}
    </ActivityResults>
  );
}

function Activities({destination, weather}: {destination: string | null; weather: string | null}) {
  const now = useNow();
  // The hints follow the clock: read again at the next whole hour.
  useRefreshAt(Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS);
  const {hints, suggested} = activityContext(now, weather);
  const chosen = useFindChoices(state => state.activity);
  const choose = useFindChoices(state => state.choose);
  const client = useQueryClient();
  const history = useActivityHistory();
  // The tiles stand low on the long page: a chosen tile's results are brought into view (their height is held from
  // the first frame, so the scroll lands where the cards will stand).
  const results = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reveal) results.current?.scrollIntoView({block: 'nearest', behavior: reduced ? 'auto' : 'smooth'});
  }, [reveal, reduced]);
  const pick = (activity: ActivityId) => {
    choose(activity);
    setReveal(count => count + 1);
    // Recorded for the wall; the answer is the new »Jeres seneste stemninger«.
    void recordActivity(activity).then(rows => {
      if (rows) client.setQueryData(historyKey, rows);
    });
  };
  const rows = history.data ?? [];
  return (
    <>
      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="find-activities">
        <h2 id="find-activities" className={SECTION_TITLE}>Hvad skal musikken til?</h2>
        <div className="grid grid-cols-6 gap-2" role="group" aria-labelledby="find-activities">
          {ACTIVITIES.map(activity => (
            <ActivityTile key={activity.id} title={activity.title} hint={hints[activity.id] ?? ''}
              suggested={suggested === activity.id} isSelected={chosen === activity.id}
              onChange={selected => {
                if (selected) pick(activity.id);
                else choose(null);
              }} />
          ))}
        </div>
      </section>
      {chosen ? (
        <div ref={results}>
          <ActivityShelf key={chosen} activity={chosen} hint={hints[chosen]} destination={destination} />
        </div>
      ) : null}
      {rows.length ? (
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="find-history">
          <h2 id="find-history" className={SECTION_TITLE}>Jeres seneste stemninger</h2>
          <div className="flex flex-col gap-2">
            {rows.map(row => (
              <ActivityHistoryRow key={row.activity} title={activityTitle(row.activity)}
                when={activityWhen(row.at, now)} colour={ACTIVITY_COLOUR[row.activity]}
                onPress={() => { pick(row.activity); }} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
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
  const weatherState = useEntity(weather[0] ?? null)?.state ?? null;
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
      <Activities destination={destination} weather={weatherState} />
      <Notice text={wishNotice(start)} />
    </section>
  );
}
