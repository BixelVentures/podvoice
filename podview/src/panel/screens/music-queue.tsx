// Kø (Afspiller, design canvas Musik-Koe): what comes next in the room, as PodConnect's native queue has it
// (podvoice.music_queue), on the kit's queue card. Texts are the pre-React player's (presentation.ts queueFaces).
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import {useState} from 'react';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import {media, playKey} from '../../lib/ha/media';
import {accountOf, isActive, music, queueKeyOf, sourceOf, trackKey, useQueue} from '../../lib/ha/podconnect';
import type {QueueRead} from '../../lib/ha/podconnect';
import {useEntity, useLink} from '../../lib/ha/transport';
import {TRANSITION} from '../../lib/motion/tokens';
import {Button, QueueCard, QueueNote, QueuePlaceholder, QueueRow} from '../../ui';
import {useNav} from '../nav';
import {UNKNOWN_TEXT} from '../ui';
import {OTHER_ACCOUNT} from './music-speakers';

// The row last chosen per player (K6: the same song twice in the queue: the list moves at the chosen occurrence).
const chosenRow = new Map<string, {id: string; uri: string}>();

const text = (value: unknown) => (typeof value === 'string' ? value : '');

// Why a room shows no rows, in the old player's words.
const STATUS_TEXT: Partial<Record<QueueRead['status'], string>> = {
  other_account: OTHER_ACCOUNT,
  elsewhere: 'Afspilning ikke bekræftet',
  unobserved: 'Afspilning ikke bekræftet',
  unavailable: 'Køen kunne ikke hentes',
  not_podconnect: 'Køen kunne ikke hentes',
};

// The queue of what a room plays, while it can be read: something plays or pauses there, it is not radio and not
// another Spotify login. A new track (or a resync) is a new read (the query key carries both).
export function useQueueRead(entityId: string | null) {
  const entity = useEntity(entityId);
  const {generation} = useLink();
  const readable = isActive(entity) && sourceOf(entity) !== 'radio' && accountOf(entity) !== 'other';
  return {entity, readable, ...useQueue(entityId, trackKey(entity), generation, readable)};
}

// The current row's identity per player: it keeps the key of the queue row it came from while that track plays, so
// the row that was chosen is the row that moves up into slot 1 (G7 #4), and a later read never re-mounts it.
const currentRow = new Map<string, {uri: string; key: string}>();

// A row's identity across reads: the track and its occurrence (K6: the same song twice is two rows). Read ids are
// not needed for it, so a new read with the same songs never re-mounts them.
function rowKeys(rows: readonly {uri: string}[]): string[] {
  const seen = new Map<string, number>();
  return rows.map(row => {
    const n = seen.get(row.uri) ?? 0;
    seen.set(row.uri, n + 1);
    return `${row.uri}#${String(n)}`;
  });
}

// Musik-Koe: the current song is row 1, the queue's rows follow. A tap on a later row plays that occurrence once;
// the row shows »Starter…« until the speaker plays it, and row 1 keeps its mark until then. Only when the speaker
// confirms does the list move: the chosen row itself moves up into slot 1 (one shared layout id per track), the rows
// above it leave, and the numbers stay as they were until they are gone (no row is ever numbered twice). A tap on
// row 1 pauses or resumes. Radio and nothing playing have no queue.
export function Queue({entityId, room}: {entityId: string; room: string}) {
  // The shell keeps this read warm from the page's start (QueuePrefetch), so the player opens with its queue.
  const {entity, readable, data, isError, isFetching} = useQueueRead(entityId);
  const reduced = useReducedMotion() ?? false;
  const push = useNav(state => state.push);
  const play = useStore(commands.store, state => state.wishes[playKey(entityId)]);
  const wish = useStore(commands.store, state => state.wishes[queueKeyOf(entityId)]);
  const active = isActive(entity);
  const radio = sourceOf(entity) === 'radio';
  const other = accountOf(entity) === 'other';
  const wished = play && (play.phase === 'sending' || play.phase === 'awaiting') ? (play.value as string) : null;
  const playing = (wished ?? entity?.state) === 'playing';
  const rows = readable && data?.status === 'ready' ? data.items : [];
  const keys = rowKeys(rows);
  // The speaker confirmed a row (it plays that track): the rows up to it leave now.
  const playingUri = text(entity?.attributes.media_content_id);
  const chosen = chosenRow.get(entityId);
  const chosenAt = chosen?.uri === playingUri ? rows.findIndex(item => item.id === chosen.id) : -1;
  const at = chosenAt >= 0 ? chosenAt : rows.findIndex(item => item.uri === playingUri);
  const items = at >= 0 ? rows.slice(at + 1) : rows;
  const itemKeys = at >= 0 ? keys.slice(at + 1) : keys;
  const starting = wish && (wish.phase === 'sending' || wish.phase === 'awaiting') ? (wish.value as string) : null;
  const count = items.length + 1;
  const reason = !entity ? '' : other ? OTHER_ACCOUNT : !active ? 'Intet spiller lige nu'
    : radio ? 'Radio har ingen kø' : isError ? 'Køen kunne ikke hentes' : data ? STATUS_TEXT[data.status] ?? '' : '';
  const choice = wish?.phase === 'rejected' ? 'Køvalget blev afvist' : wish?.phase === 'unknown' ? UNKNOWN_TEXT : '';
  const meta = choice || reason || (data ? `${String(count)} ${count === 1 ? 'nummer' : 'numre'} · ${room}` : room);
  const loading = active && !radio && readable && !data && !isError;
  const title = text(entity?.attributes.media_title), artist = text(entity?.attributes.media_artist);
  const cover = text(entity?.attributes.entity_picture);
  const showCurrent = !!entity && active && !radio && !!title;
  // Row 1's key: the chosen row's while its track plays (it moved up), else the track's own.
  const held = currentRow.get(entityId);
  const track = playingUri || title;
  const currentKey = held?.uri === track ? held.key : (at >= 0 ? keys[at] : undefined) ?? `now:${track}`;
  if (showCurrent && held?.key !== currentKey) currentRow.set(entityId, {uri: track, key: currentKey});
  // The numbers shown: while rows leave, the ones that stay keep the number they had (frozen), and take their new
  // place's number once the leaving rows are gone.
  const shownKeys = [...(showCurrent ? [currentKey] : []), ...itemKeys];
  const list = shownKeys.join('|');
  const numbers = new Map(itemKeys.map((key, index) => [key, index + 2]));
  const [numbering, setNumbering] = useState<{list: string; keys: string[]; numbers: Map<string, number>;
    frozen: Map<string, number> | null}>(() => ({list, keys: shownKeys, numbers, frozen: null}));
  if (numbering.list !== list) {
    const leaving = numbering.keys.some(key => !shownKeys.includes(key));
    setNumbering({list, keys: shownKeys, numbers, frozen: leaving ? numbering.numbers : numbering.frozen});
  }
  const numberOf = (key: string) => numbering.frozen?.get(key) ?? numbers.get(key) ?? 0;
  const move = reduced ? TRANSITION.reduced : {...TRANSITION.smooth, opacity: TRANSITION.fade};
  return (
    // The column slides 16 px up and fades in when Afspiller opens (Musik-Koe, 320 ms); never on the page's first
    // paint (the screen is built on its first visit) and only a fade with reduced motion.
    <motion.div className="flex min-h-0 flex-1 flex-col" initial={reduced ? {opacity: 0} : {opacity: 0, y: 16}}
      animate={{opacity: 1, y: 0}} transition={reduced ? TRANSITION.reduced : {duration: 0.32,
        ease: [0.2, 0.9, 0.3, 1]}}>
      <QueueCard className="flex-1" heading="Kø" meta={meta} busy={loading || isFetching}
        status={loading ? 'loading' : reason ? 'error' : 'ready'}
        // Afspiller's way to Find musik (G7 ruling): also when nothing plays here.
        action={<Button variant="sekundaer" size={44} icon="disc" data-opens="find" onPress={() => {
          push('find');
        }}>Find musik</Button>}>
        {/* One list: row 1 and the queue. A row keeps its identity (and layout id) when it moves from the queue
            into slot 1; a row that leaves goes out of the flow and fades, the rest glide on the smooth spring. */}
        <AnimatePresence initial={false} mode="popLayout" onExitComplete={() => {
          setNumbering(state => (state.frozen ? {...state, frozen: null} : state));
        }}>
          {showCurrent ? (
            <motion.div key={currentKey} layoutId={`queue:${currentKey}`} layout="position" exit={{opacity: 0}}
              transition={move}>
              <QueueRow index={1} title={title} artist={artist}
                cover={/^(?:\/api\/|https:\/\/)/.test(cover) ? cover : null}
                mark={playing ? 'playing' : 'paused'} data-current="true"
                data-playback={playing ? 'playing' : 'paused'} data-row={currentKey}
                label={`${playing ? 'Spiller nu:' : 'På pause:'} ${[title, artist].filter(Boolean).join(' · ')}` +
                  (other ? '' : ` · ${playing ? 'Sæt på pause' : 'Fortsæt'}`)}
                isDisabled={other}
                onPress={() => {
                  media.playPause(entityId, !playing);
                }} />
            </motion.div>
          ) : null}
          {items.map((item, index) => {
            const key = itemKeys[index] ?? item.id;
            const busy = starting === item.id;
            const number = numberOf(key);
            const copy = [String(number), item.title, item.artist].filter(Boolean).join(' · ');
            const selectable = data?.selectable === true;
            return (
              <motion.div key={key} layoutId={`queue:${key}`} layout="position" exit={{opacity: 0}}
                transition={move}>
                <QueueRow index={number} title={item.title} artist={item.artist} cover={item.artwork ?? null}
                  mark={busy ? 'starting' : null} data-track-id={item.id} data-current="false" data-row={key}
                  data-playback="upcoming" data-busy={busy ? 'true' : undefined}
                  label={`${busy ? 'Starter:' : selectable ? 'Afspil' : 'Kun visning:'} ${copy}`}
                  isDisabled={!selectable}
                  onPress={() => {
                    // Never locked: a tap on another row while one starts is the newer choice (last tap wins).
                    if (!selectable) return;
                    chosenRow.set(entityId, {id: item.id, uri: item.uri});
                    music.playQueueItem(entityId, item);
                  }} />
              </motion.div>
            );
          })}
        </AnimatePresence>
        {loading ? [2, 3, 4].map(index => <QueuePlaceholder key={index} index={index} />) : null}
        {readable && data?.status === 'empty' ? <QueueNote>Ingen sange i køen.</QueueNote> : null}
      </QueueCard>
    </motion.div>
  );
}
