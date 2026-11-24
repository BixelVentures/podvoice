// The room's music player: a PodConnect media_player in the room (HA area). Status is the speaker's own state as HA
// reports it; play/pause, next, previous and volume are media_player.* on that entity. A tap shows its wish at once
// and never locks the controls; the speaker's next state confirms it, else the outcome is shown as unknown.
// While HA briefly has no state for the player (a restart, a resync) the last known track stays, marked as such.
// Another Spotify login playing in the room is shown, never controlled (the add-on's rule).
// Musik: the room's full player (its queue, »Afspil på« to move the music, Find musik and Radio), then every other
// PodConnect speaker HA has, by room.
import {useState} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import type {ReactNode} from 'react';
import {create, useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {lastKnownPlayers, media, playerModel, playKey, roomPlayer, skipKey, volumeKey} from '../../lib/ha/media';
import type {PlayState} from '../../lib/ha/media';
import {accountOf, isActive, MOVE_KEY, ownMusic, useSpeakers} from '../../lib/ha/podconnect';
import {useEntities, useEntity} from '../../lib/ha/transport';
import {useRoomCatalog} from '../../lib/ha/speaker-rooms';
import {useNav} from '../nav';
import {useRoom} from '../room';
import {Notice, wishNotice} from '../ui';
import {Button, Chip, Choices, cx, Icon, IconButton, pressable, Slider, tv} from '../../ui';
import {Queue, useQueueRead} from './music-queue';
import {nameOf, OTHER_ACCOUNT, SpeakerSheet, usePickerContext, useQueuedChoice} from './music-speakers';

export const STATE_LABEL: Record<PlayState, string> = {
  playing: 'Spiller',
  paused: 'På pause',
  idle: 'Klar',
  off: 'Slukket',
  on: 'Tændt',
  buffering: 'Henter',
  standby: 'Standby',
  unavailable: 'Ikke tilgængelig',
};

export function useShownPlayer(entity: HassEntityState | null, entityId: string) {
  const last = useStore(lastKnownPlayers, state => state.models[entityId]);
  const model = entity ? playerModel(entity) : null;
  if (model?.available) return {model, lastKnown: false};
  if (last) return {model: last, lastKnown: true};
  return {model, lastKnown: false};
}

// A speaker's card: the music identity's hero (cover, track, the speaker's own status, transport and volume).
// Compact (the aside) stacks the cover over the track.
export const hero = tv({
  base: [
    'flex min-w-0 flex-col gap-pv-s3 rounded-pv-l bg-pv-surface p-pv-s4 text-pv-ink',
    'shadow-[inset_0_0_0_1px_var(--color-pv-line),var(--shadow-pv)]',
  ],
  variants: {
    compact: {true: 'min-h-[200px] items-start justify-center', false: ''},
    offline: {true: 'group-data-[link=offline]/host:opacity-55', false: ''},
  },
});

function EmptyCard({title, body}: {title: string; body: ReactNode}) {
  return (
    <article className={hero({compact: false, offline: false})}>
      <p className="text-pv-label font-semibold">{title}</p>
      <span className="text-pv-body text-pv-ink-2">{body}</span>
    </article>
  );
}

export function PlayerCard({entityId, compact = false}: {entityId: string; compact?: boolean}) {
  const entity = useEntity(entityId);
  const {model, lastKnown} = useShownPlayer(entity, entityId);
  const play = useStore(commands.store, state => state.wishes[playKey(entityId)]);
  const skip = useStore(commands.store, state => state.wishes[skipKey(entityId)]);
  const volume = useStore(commands.store, state => state.wishes[volumeKey(entityId)]);
  if (!model) {
    return <EmptyCard title="Højttaleren er ikke tilgængelig"
      body={`Home Assistant har ingen tilstand for ${entityId} lige nu.`} />;
  }
  const other = accountOf(entity) === 'other' && isActive(entity);
  const live = !lastKnown && model.available && !other;
  const wished = play && (play.phase === 'sending' || play.phase === 'awaiting') ? (play.value as string) : null;
  const playing = (wished ?? model.state) === 'playing';
  const shownVolume =
    volume && (volume.phase === 'sending' || volume.phase === 'awaiting') ? (volume.value as number) : model.volume;
  const notice = wishNotice(play) || wishNotice(skip) || wishNotice(volume);
  const status = lastKnown ? 'Sidst kendt · ikke tilgængelig lige nu' : other ? OTHER_ACCOUNT
    : STATE_LABEL[model.state];
  const art = compact ? 'size-[174px]' : 'size-24';
  return (
    <article
      className={hero({compact, offline: true})}
      data-player-state={lastKnown ? 'last-known' : other ? 'other-account' : model.state}
      aria-label={`${model.name}: ${status}`}
    >
      <div className={cx('flex min-w-0 gap-pv-s3', compact ? 'flex-col items-start' : 'items-center')}>
        {model.artwork ? (
          <img className={cx(art, 'shrink-0 rounded-pv-l bg-pv-surface object-cover')} src={model.artwork} alt=""
            decoding="async" />
        ) : (
          <span className={cx(art, 'grid shrink-0 place-items-center rounded-pv-l bg-pv-surface')} aria-hidden="true">
            <Icon name="music-note-beamed" className="size-10" />
          </span>
        )}
        <div className="grid min-w-0 gap-pv-s1">
          <p className="my-5 truncate text-pv-label font-semibold">
            {model.title || (model.state === 'off' ? 'Slukket' : 'Intet spiller')}
          </p>
          <span className="leading-5" hidden={!model.artist}>
            {model.artist}
          </span>
          <small className="flex items-center gap-pv-s1 text-pv-meta text-pv-ink-2">
            <Icon name="speaker-output" className="size-[18px]" /> {model.name} · {status}
          </small>
        </div>
      </div>
      <div className={cx('flex items-center gap-pv-s2', compact ? 'w-full *:flex-1' : 'gap-pv-s3')} role="group"
        aria-label="Afspilning">
        <IconButton
          aria-label="Forrige"
          className="px-pv-s4"
          hidden={!model.can.previous}
          isDisabled={!live}
          onPress={() => {
            media.skip(entityId, 'previous');
          }}
        >
          <Icon name="skip-start-fill" />
        </IconButton>
        <IconButton
          variant="primary"
          className="px-pv-s4"
          aria-label={playing ? 'Pause' : 'Afspil'}
          busy={play?.phase === 'sending' || play?.phase === 'awaiting'}
          hidden={!(playing ? model.can.pause : model.can.play)}
          isDisabled={!live}
          onPress={() => {
            media.playPause(entityId, !playing);
          }}
        >
          <Icon name={playing ? 'pause-fill' : 'play-fill'} className="size-7" />
        </IconButton>
        <IconButton
          aria-label="Næste"
          className="px-pv-s4"
          hidden={!model.can.next}
          isDisabled={!live}
          onPress={() => {
            media.skip(entityId, 'next');
          }}
        >
          <Icon name="skip-end-fill" />
        </IconButton>
      </div>
      {model.can.volume || shownVolume !== null ? (
        <Slider
          className="w-full gap-x-pv-s2 gap-y-pv-s1"
          label="Lydstyrke"
          value={shownVolume === null ? null : Math.round(shownVolume * 100)}
          isDisabled={!live || !model.can.volume}
          format={value => `${String(value)} %`}
          onCommit={value => {
            media.volume(entityId, value / 100);
          }}
        />
      ) : null}
      <Notice text={notice} />
    </article>
  );
}

// Which of the room's players is shown: the chosen one (last tap wins), else the one playing, paused or available.
const usePlayerChoice = create<{byRoom: Record<string, string | undefined>}>(() => ({byRoom: {}}));

// The room's players and the one shown (the full player on Musik, the aside and Ro show the same speaker).
export function useRoomPlayer() {
  const {room} = useRoom();
  const players = room?.players ?? [];
  const states = useEntities(players);
  const chosen = usePlayerChoice(state => (room ? state.byRoom[room.id] : undefined));
  const current = chosen && players.includes(chosen) ? chosen : (roomPlayer(states)?.entity_id ?? players[0] ?? null);
  return {room, players, states, current};
}

// The page keeps the room player's queue warm from its start, as it does Robot's: read when the page starts and
// when HA pushes a new track, never polled. The full player's first frame then has the queue, not placeholders (H6).
export function QueuePrefetch() {
  useQueueRead(useRoomPlayer().current);
  return null;
}

export function RoomMusic({compact = false}: {compact?: boolean}) {
  const {room, players, states, current} = useRoomPlayer();
  if (!room || !current) {
    return (
      <EmptyCard
        title="Ingen højttaler i rummet"
        body={'Home Assistant har ingen PodConnect-højttaler i dette område. ' +
          'Placér højttaleren i et område i Home Assistant.'}
      />
    );
  }
  return (
    <>
      {players.length > 1 && !compact ? (
        <Choices
          aria-label="Højttaler"
          className="mb-pv-s3 flex flex-wrap gap-pv-s1"
          value={current}
          onChange={id => {
            usePlayerChoice.setState(state => ({byRoom: {...state.byRoom, [room.id]: id}}));
          }}
        >
          {players.map((id, index) => (
            <Chip key={id} id={id}>
              {nameOf(states[index] ?? null, id)}
            </Chip>
          ))}
        </Choices>
      ) : null}
      <PlayerCard entityId={current} compact={compact} />
    </>
  );
}

// The full player's speaker line (the old player's detail output): where the music plays and »Vælg højttaler«;
// a pending move or the next start's destination shows at once.
function OutputButton({entityId, onPress}: {entityId: string; onPress: () => void}) {
  const entity = useEntity(entityId);
  const next = useSpeakers(state => state.nextDestination);
  const queued = useSpeakers(state => state.queued);
  const move = useStore(commands.store, state => state.wishes[MOVE_KEY]);
  const nextEntity = useEntity(queued?.to ?? (move?.phase === 'sending' || move?.phase === 'awaiting'
    ? (move.value as string) : next));
  const chosen = queued?.to ?? (move?.phase === 'sending' || move?.phase === 'awaiting' ? (move.value as string)
    : null);
  const other = accountOf(entity) === 'other' && isActive(entity);
  const label = [
    chosen ? `Valgt: ${nameOf(nextEntity, chosen)} · skifter højttaler` : nameOf(entity, entityId),
    !chosen && next && next !== entityId ? `Næste afspilning: ${nameOf(nextEntity, next)}` : '',
    other ? '' : chosen ? 'Afventer bekræftelse' : ownMusic(entity) ? 'Aktuelt output · Vælg højttaler'
      : 'Vælg højttaler',
  ].filter(Boolean).join(' · ');
  return (
    <AriaButton
      id="detail-output"
      className={cx(pressable, 'flex min-h-pv-hit w-full items-center gap-pv-s3 rounded-pv-s bg-pv-surface-2 p-pv-s2',
        'text-left text-pv-body text-pv-ink')}
      aria-label={label}
      aria-haspopup="dialog"
      isDisabled={other}
      onPress={onPress}
    >
      <Icon name="speaker-output" />
      <span className="flex-1 font-semibold">{label}</span>
    </AriaButton>
  );
}

// The room's full player: the card, »Afspil på«, the way to music and radio, and the queue.
function FullPlayer() {
  const {room, current} = useRoomPlayer();
  const [open, setOpen] = useState(false);
  const push = useNav(state => state.push);
  if (!room || !current) return null;
  return (
    <section className="grid gap-pv-s3" aria-label={`Afspiller · ${room.name}`}>
      <PlayerCard entityId={current} />
      <OutputButton
        entityId={current}
        onPress={() => {
          setOpen(true);
        }}
      />
      <div className="mb-pv-s3 flex flex-wrap gap-pv-s1" role="group" aria-label="Find noget at spille">
        <Button size="chip" data-opens="find" onPress={() => { push('find'); }}>
          Vælg musik
        </Button>
        <Button size="chip" data-opens="radio" onPress={() => { push('radio'); }}>
          Radio
        </Button>
      </div>
      <Queue entityId={current} />
      <SpeakerSheet isOpen={open} onOpenChange={setOpen} from={current} />
    </section>
  );
}

// The picker's queued choice runs while Musik is mounted (always: the shell keeps every screen).
function QueuedChoice({from}: {from: string | null}) {
  useQueuedChoice(usePickerContext(from));
  return null;
}

// A music screen's column (Musik, Find musik, Radio) and its heading: the title and one line under it.
export const SCREEN = 'flex flex-[1_0_auto] flex-col overflow-hidden rounded-pv-l bg-pv-surface p-pv-s3';

export function ScreenHeading({id, title, line, className}: {id: string; title: string; line: string;
  className?: string}) {
  return (
    <header className={cx('pb-pv-s3', className)}>
      <h1 id={id} className="mt-0 mb-2.5 text-pv-title leading-[1.08] font-medium tracking-[-0.035em]">{title}</h1>
      <p className="text-pv-meta leading-[normal] text-pv-ink-3">{line}</p>
    </header>
  );
}

// Musik: the room's full player, then every other PodConnect speaker HA has, by room. Each is controlled on its own
// entity; the status shown is that speaker's.
export function MusicScreen() {
  const {rooms} = useRoom();
  const {current} = useRoomPlayer();
  const unplaced = useRoomCatalog().unplaced.players;
  const groups = [...rooms, ...(unplaced.length ? [{id: '', name: 'Uden område', players: unplaced, lights: []}] : [])]
    .map(group => ({...group, players: group.players.filter(id => id !== current)}))
    .filter(group => group.players.length);
  return (
    <section id="music-view" className={SCREEN} aria-labelledby="music-title">
      <ScreenHeading id="music-title" title="Musik"
        line={current || groups.length ? 'Højttalere i hjemmet' : 'Ingen PodConnect-højttalere i Home Assistant'} />
      <FullPlayer />
      <QueuedChoice from={current} />
      {groups.map(group => (
        <section key={group.id || 'unplaced'} className="mb-pv-s3 grid gap-pv-s2" aria-label={group.name}>
          <h2 className="text-pv-label leading-6 font-semibold tracking-[-0.4px]">{group.name}</h2>
          {group.players.map(id => (
            <PlayerCard key={id} entityId={id} />
          ))}
        </section>
      ))}
    </section>
  );
}
