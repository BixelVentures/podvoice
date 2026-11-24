// Kø: what comes next in the full player's room, as PodConnect's native queue has it (podvoice.music_queue). The
// playing track leads the list (a tap pauses or resumes it); a tap on a later row plays that occurrence once, and
// the speaker playing it confirms the choice. Texts are the pre-React player's (presentation.ts queueFaces).
import {motion, useReducedMotion} from 'motion/react';
import type {ReactNode} from 'react';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {media, playKey} from '../../lib/ha/media';
import {accountOf, isActive, music, queueKeyOf, sourceOf, trackKey, useQueue} from '../../lib/ha/podconnect';
import type {QueueItem, QueueRead} from '../../lib/ha/podconnect';
import {useEntity, useLink} from '../../lib/ha/transport';
import {useShown} from '../../lib/motion/shown';
import {TRANSITION} from '../../lib/motion/tokens';
import {Button} from 'react-aria-components';
import {cx, Icon, pressable} from '../../ui';
import {UNKNOWN_TEXT} from '../ui';
import {nameOf, OTHER_ACCOUNT} from './music-speakers';

// A queue row: its place (or the playing mark), the cover, title and artist, and what a tap does.
const ROW = cx(pressable, 'grid w-full min-h-[72px] grid-cols-[32px_64px_minmax(0,1fr)_32px] items-center gap-pv-s2',
  'rounded-pv-s bg-pv-surface-2 p-pv-s2 text-left text-pv-body text-pv-ink');
const ORDER = 'grid place-items-center text-pv-meta text-pv-ink-3';
const COVER = 'pointer-events-none size-pv-hit rounded-pv-s bg-pv-surface object-cover';
const text = (value: unknown) => (typeof value === 'string' ? value : '');

// Why a room shows no rows, in the old player's words.
const STATUS_TEXT: Partial<Record<QueueRead['status'], string>> = {
  other_account: OTHER_ACCOUNT,
  elsewhere: 'Afspilning ikke bekræftet',
  unobserved: 'Afspilning ikke bekræftet',
  unavailable: 'Køen kunne ikke hentes',
  not_podconnect: 'Køen kunne ikke hentes',
};

function Cover({src}: {src: string | null}) {
  return src ? (
    <img className={COVER} src={src} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className={cx(COVER, 'grid place-items-center')}>
      <Icon name="music-note-beamed" className="size-pv-icon-m" />
    </span>
  );
}

function Copy({title, artist}: {title: ReactNode; artist: ReactNode}) {
  return (
    <span className="grid min-w-0 gap-pv-s1">
      <strong className="truncate font-normal">{title}</strong>
      <small className="truncate text-pv-meta text-pv-ink-3">{artist}</small>
    </span>
  );
}

// The playing mark: three still bars, as the old player drew its equalizer standing.
function Playing() {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {['h-2', 'h-4', 'h-3'].map(height => <i key={height} className={cx('w-1 rounded-full bg-pv-ink-3', height)} />)}
    </span>
  );
}

function CurrentRow({entityId, entity}: {entityId: string; entity: HassEntityState}) {
  const play = useStore(commands.store, state => state.wishes[playKey(entityId)]);
  const wished = play && (play.phase === 'sending' || play.phase === 'awaiting') ? (play.value as string) : null;
  const playing = (wished ?? entity.state) === 'playing';
  const title = text(entity.attributes.media_title), artist = text(entity.attributes.media_artist);
  const readOnly = accountOf(entity) === 'other';
  return (
    <Button
      className={ROW}
      data-current="true"
      data-playback={playing ? 'playing' : 'paused'}
      aria-current="true"
      aria-label={`${playing ? 'Spiller nu:' : 'På pause:'} ${[title, artist].filter(Boolean).join(' · ')}` +
        (readOnly ? '' : ` · ${playing ? 'Sæt på pause' : 'Fortsæt'}`)}
      isDisabled={readOnly}
      onPress={() => {
        media.playPause(entityId, !playing);
      }}
    >
      <span className={ORDER}>{playing ? <Playing /> : <Icon name="pause-fill" />}</span>
      <Cover src={null} />
      <Copy title={title} artist={artist} />
      <Icon name={playing ? 'pause-fill' : 'play-fill'} />
    </Button>
  );
}

function QueueRow({entityId, item, selectable}: {entityId: string; item: QueueItem; selectable: boolean}) {
  const reduced = useReducedMotion();
  const wish = useStore(commands.store, state => state.wishes[queueKeyOf(entityId)]);
  const starting = wish?.value === item.id && (wish.phase === 'sending' || wish.phase === 'awaiting');
  const copy = [String(item.order), item.title, item.artist].filter(Boolean).join(' · ');
  return (
    <motion.div
      layout={reduced ? false : 'position'}
      initial={reduced ? {opacity: 0} : {opacity: 0, transform: 'translate3d(0, 8px, 0)'}}
      animate={{opacity: 1, transform: 'translate3d(0, 0, 0)'}}
      transition={reduced ? TRANSITION.reduced : TRANSITION.smooth}
    >
      <Button
        className={ROW}
        data-track-id={item.id}
        data-current="false"
        data-playback="upcoming"
        data-busy={starting ? 'true' : undefined}
        aria-label={`${starting ? 'Starter:' : selectable ? 'Afspil' : 'Kun visning:'} ${copy}`}
        isDisabled={!selectable}
        onPress={() => {
          // Never locked: a tap on another row while one starts is the newer choice (last tap wins).
          if (selectable) music.playQueueItem(entityId, item);
        }}
      >
        <span className={ORDER}>{String(item.order)}</span>
        <Cover src={item.artwork ?? null} />
        <Copy title={item.title} artist={item.artist} />
        <Icon name="play-fill" className="group-data-[disabled]:opacity-60" />
      </Button>
    </motion.div>
  );
}

// Loading keeps the list's height: an empty row of the real row's size that pulses, hidden from assistive
// technology (it stands still under reduced motion, and while Musik waits out of sight).
function Placeholder() {
  const shown = useShown();
  const reduced = (useReducedMotion() ?? false) || !shown;
  return (
    <div className={cx(ROW, 'relative cursor-default')} data-placeholder="true" aria-hidden="true">
      <span className="size-pv-hit" />
      <motion.span
        className="absolute inset-pv-s2 rounded-pv-s bg-pv-line"
        initial={{opacity: 0.5}}
        animate={reduced ? {opacity: 0.5} : {opacity: [0.5, 1, 0.5]}}
        transition={reduced ? TRANSITION.reduced : TRANSITION.ambient()}
      />
    </div>
  );
}

// The queue of what a room plays, while it can be read: something plays or pauses there, it is not radio and not
// another Spotify login. A new track (or a resync) is a new read (the query key carries both).
export function useQueueRead(entityId: string | null) {
  const entity = useEntity(entityId);
  const {generation} = useLink();
  const readable = isActive(entity) && sourceOf(entity) !== 'radio' && accountOf(entity) !== 'other';
  return {entity, readable, ...useQueue(entityId, trackKey(entity), generation, readable)};
}

export function Queue({entityId}: {entityId: string}) {
  // The shell keeps this read warm from the page's start (QueuePrefetch), so the player opens with its queue.
  const {entity, readable, data, isError, isFetching} = useQueueRead(entityId);
  const active = isActive(entity);
  const radio = sourceOf(entity) === 'radio';
  const wish = useStore(commands.store, state => state.wishes[queueKeyOf(entityId)]);
  // Radio has no queue (the old player hid it); nothing playing has nothing next.
  if (!entity || !active || radio) return null;
  const items = readable && data?.status === 'ready' ? data.items : [];
  const count = items.length + 1;
  const reason = accountOf(entity) === 'other' ? OTHER_ACCOUNT : isError ? 'Køen kunne ikke hentes'
    : data ? STATUS_TEXT[data.status] ?? '' : '';
  const choice = wish?.phase === 'rejected' ? 'Køvalget blev afvist' : wish?.phase === 'unknown' ? UNKNOWN_TEXT : '';
  const meta = choice || reason || (data ? `${String(count)} ${count === 1 ? 'nummer' : 'numre'} · ${
    nameOf(entity, entityId)}` : '');
  const loading = readable && !data && !isError;
  return (
    <section className="mt-pv-s3 border-t border-pv-line pt-pv-s3" aria-labelledby="queue-title">
      <h2 id="queue-title" className="mb-pv-s1 text-pv-meta leading-[18px] font-medium tracking-[-0.4px] text-pv-ink-3">
        Kø
      </h2>
      <p id="queue-meta" className="my-pv-s2 text-pv-meta text-pv-ink-2" role="status">
        {meta}
      </p>
      <div
        id="queue"
        className="flex flex-col gap-pv-s1"
        role="group"
        aria-label={choice || 'Kø'}
        aria-busy={loading || isFetching}
        data-status={loading ? 'loading' : reason ? 'error' : 'ready'}
      >
        <CurrentRow entityId={entityId} entity={entity} />
        {items.map(item => (
          <QueueRow key={item.id} entityId={entityId} item={item} selectable={data?.selectable === true} />
        ))}
        {loading ? [0, 1, 2].map(index => <Placeholder key={index} />) : null}
        {readable && data?.status === 'empty' ? (
          <p className="text-pv-body text-pv-ink-3" data-empty="true">Ingen sange i køen.</p>
        ) : null}
      </div>
    </section>
  );
}
