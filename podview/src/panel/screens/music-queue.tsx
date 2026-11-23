// Kø: what comes next in the full player's room, as PodConnect's native queue has it (podvoice.music_queue). The
// playing track leads the list (a tap pauses or resumes it); a tap on a later row plays that occurrence once, and
// the speaker playing it confirms the choice. Texts are the pre-React player's (presentation.ts queueFaces).
import {motion, useReducedMotion} from 'motion/react';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {media, playKey} from '../../lib/ha/media';
import {accountOf, isActive, music, queueKeyOf, sourceOf, trackKey, useQueue} from '../../lib/ha/podconnect';
import type {QueueItem, QueueRead} from '../../lib/ha/podconnect';
import {useEntity, useLink} from '../../lib/ha/transport';
import {TRANSITION} from '../../lib/motion/tokens';
import {currentScreen, useNav} from '../nav';
import {icon, UNKNOWN_TEXT} from '../ui';
import {nameOf, OTHER_ACCOUNT} from './music-speakers';

const ROW = 'queue-track pv-row pv-btn pv-kit pv-kit-listrow';
const text = (value: unknown) => (typeof value === 'string' ? value : '');

// Why a room shows no rows, in the old player's words.
const STATUS_TEXT: Partial<Record<QueueRead['status'], string>> = {
  other_account: OTHER_ACCOUNT,
  elsewhere: 'Afspilning ikke bekræftet',
  unobserved: 'Afspilning ikke bekræftet',
  unavailable: 'Køen kunne ikke hentes',
  not_podconnect: 'Køen kunne ikke hentes',
};

function CurrentRow({entityId, entity}: {entityId: string; entity: HassEntityState}) {
  const play = useStore(commands.store, state => state.wishes[playKey(entityId)]);
  const wished = play && (play.phase === 'sending' || play.phase === 'awaiting') ? (play.value as string) : null;
  const playing = (wished ?? entity.state) === 'playing';
  const title = text(entity.attributes.media_title), artist = text(entity.attributes.media_artist);
  const readOnly = accountOf(entity) === 'other';
  return (
    <button
      type="button"
      className={ROW}
      data-kit="listrow"
      data-current="true"
      data-playback={playing ? 'playing' : 'paused'}
      aria-current="true"
      aria-label={`${playing ? 'Spiller nu:' : 'På pause:'} ${[title, artist].filter(Boolean).join(' · ')}` +
        (readOnly ? '' : ` · ${playing ? 'Sæt på pause' : 'Fortsæt'}`)}
      disabled={readOnly}
      onClick={() => {
        media.playPause(entityId, !playing);
      }}
    >
      <span className="queue-order" aria-label={playing ? 'Spiller nu' : 'På pause'}>
        {playing ? (
          <span className="queue-eq">
            <i></i>
            <i></i>
            <i></i>
          </span>
        ) : (
          <img src={icon('pause-fill')} alt="" width="24" height="24" />
        )}
      </span>
      <img className="queue-cover" src={icon('music-note-beamed')} alt="" />
      <span className="queue-copy">
        <strong>{title}</strong>
        <small>{artist}</small>
      </span>
      <img className="queue-play" src={icon(playing ? 'pause-fill' : 'play-fill')} alt="" />
    </button>
  );
}

function QueueRow({entityId, item, selectable}: {entityId: string; item: QueueItem; selectable: boolean}) {
  const reduced = useReducedMotion();
  const wish = useStore(commands.store, state => state.wishes[queueKeyOf(entityId)]);
  const starting = wish?.value === item.id && (wish.phase === 'sending' || wish.phase === 'awaiting');
  const copy = [String(item.order), item.title, item.artist].filter(Boolean).join(' · ');
  return (
    <motion.button
      layout={reduced ? false : 'position'}
      initial={reduced ? {opacity: 0} : {opacity: 0, transform: 'translate3d(0, 8px, 0)'}}
      animate={{opacity: 1, transform: 'translate3d(0, 0, 0)'}}
      transition={reduced ? TRANSITION.reduced : TRANSITION.smooth}
      type="button"
      className={ROW}
      data-kit="listrow"
      data-track-id={item.id}
      data-current="false"
      data-playback="upcoming"
      aria-busy={starting ? 'true' : undefined}
      aria-label={`${starting ? 'Starter:' : selectable ? 'Afspil' : 'Kun visning:'} ${copy}`}
      disabled={!selectable}
      onClick={() => {
        // Never locked: a tap on another row while one starts is the newer choice (last tap wins).
        if (selectable) music.playQueueItem(entityId, item);
      }}
    >
      <span className="queue-order" aria-label="Placering">
        {String(item.order)}
      </span>
      {item.artwork ? (
        <img className="queue-cover" src={item.artwork} alt="" />
      ) : (
        <img className="queue-cover" src={icon('music-note-beamed')} alt="" />
      )}
      <span className="queue-copy">
        <strong>{item.title}</strong>
        <small>{item.artist}</small>
      </span>
      <img className="queue-play" src={icon('play-fill')} alt="" />
    </motion.button>
  );
}

// Loading keeps the list's height: empty rows of the real row anatomy, hidden from assistive technology.
function Placeholder() {
  return (
    <button type="button" className={ROW} data-kit="listrow" data-placeholder="true" aria-hidden="true" tabIndex={-1}
      disabled>
      <span className="queue-order"></span>
      <span className="queue-cover"></span>
      <span className="queue-copy">
        <strong></strong>
        <small></small>
      </span>
      <span className="queue-play"></span>
    </button>
  );
}

export function Queue({entityId}: {entityId: string}) {
  const entity = useEntity(entityId);
  const {generation} = useLink();
  const active = isActive(entity);
  const radio = sourceOf(entity) === 'radio';
  const readable = active && !radio && accountOf(entity) !== 'other';
  // Read only while Musik is shown (the shell keeps every screen mounted): no PodConnect read nobody sees.
  const shown = useNav(currentScreen) === 'music';
  const {data, isError, isFetching} = useQueue(entityId, trackKey(entity), generation, readable && shown);
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
    <section className="detail-queue pv-panel-queue" aria-labelledby="queue-title">
      <h2 id="queue-title">Kø</h2>
      <p id="queue-meta" role="status">
        {meta}
      </p>
      <div
        id="queue"
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
        {readable && data?.status === 'empty' ? <p className="queue-empty">Ingen sange i køen.</p> : null}
      </div>
    </section>
  );
}
