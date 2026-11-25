// The room's music player: a PodConnect media_player in the room (HA area). Status is the speaker's own state as HA
// reports it; play/pause, next, previous and volume are media_player.* on that entity. A tap shows its wish at once
// and never locks the controls; the speaker's next state confirms it, else the outcome is shown as unknown.
// While HA briefly has no state for the player (a restart, a resync) the last known track stays, marked as such.
// Another Spotify login playing in the room is shown, never controlled (the add-on's rule).
// Musik: the room's full player (its queue, »Afspil på« to move the music, Find musik and Radio), then every other
// PodConnect speaker HA has, by room.
import {useEffect, useState} from 'react';
import {Button as AriaButton} from 'react-aria-components';
import type {ReactNode} from 'react';
import {create, useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {lastKnownPlayers, media, playerModel, playKey, roomPlayer, skipKey, volumeKey} from '../../lib/ha/media';
import type {PlayState} from '../../lib/ha/media';
import {accountOf, isActive, MOVE_KEY, ownMusic, useSpeakers} from '../../lib/ha/podconnect';
import {transport, useEntities, useEntity} from '../../lib/ha/transport';
import {useRoomCatalog} from '../../lib/ha/speaker-rooms';
import {useNav} from '../nav';
import {useRoom} from '../room';
import {Notice, wishNotice} from '../ui';
import {Button, Chip, Choices, cx, Icon, IconButton, Modal, Player, pressable, Slider, tv} from '../../ui';
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

// The room key's sheet (docs/PODVIEW-PARITY.md, decision 1), in »Afspil på«'s style: the rooms (HA areas) as rows,
// each with what it has, and the room's speakers when it has more than one. A choice shows at once and closes the
// sheet; the room is the page's (Hjem, Lys and the player follow it).
const ROOM_ROW = 'min-h-24 w-full justify-start gap-pv-s2 rounded-pv-l px-pv-s2 text-left';

function RoomSheet({isOpen, onClose}: {isOpen: boolean; onClose: () => void}) {
  const {room, players, states, current} = useRoomPlayer();
  const {rooms} = useRoom();
  const setRoom = useNav(state => state.setRoom);
  const count = (n: number, one: string, many: string) => (n ? `${String(n)} ${n === 1 ? one : many}` : '');
  return (
    <Modal id="room-picker" isOpen={isOpen} onClose={onClose} title="Vælg rum" className="w-[560px]"
      description="Skærmen viser rummets musik og lys."
      action={
        <IconButton variant="quiet" aria-label="Luk" onPress={onClose}>
          <Icon name="x-lg" />
        </IconButton>
      }>
      <Choices aria-label="Rum" className="grid gap-pv-s2" value={room?.id ?? null} onChange={id => {
        setRoom(id);
        onClose();
      }}>
        {rooms.map(item => (
          <Chip key={item.id} id={item.id} className={ROOM_ROW} aria-label={item.name}>
            <Icon name="speaker-output" className="size-pv-icon-m in-data-[selected]:invert" />
            <span className="grid min-w-0 gap-pv-s1">
              <strong className="truncate text-pv-label font-semibold">{item.name}</strong>
              <small className="text-pv-meta opacity-75">
                {[count(item.players.length, 'højttaler', 'højttalere'), count(item.lights.length, 'lampe', 'lamper')]
                  .filter(Boolean).join(' · ') || 'Intet at vise'}
              </small>
            </span>
          </Chip>
        ))}
      </Choices>
      {room && players.length > 1 ? (
        <Choices aria-label="Højttaler" value={current} onChange={id => {
          usePlayerChoice.setState(state => ({byRoom: {...state.byRoom, [room.id]: id}}));
        }}>
          {players.map((id, index) => (
            <Chip key={id} id={id}>
              {nameOf(states[index] ?? null, id)}
            </Chip>
          ))}
        </Choices>
      ) : null}
    </Modal>
  );
}

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Where the track is, from HA's media_position (advancing from media_position_updated_at while it plays).
function useProgress(entity: HassEntityState | null, playing: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!playing) return;
    const handle = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(handle);
    };
  }, [playing]);
  const a = entity?.attributes;
  const duration = typeof a?.media_duration === 'number' && a.media_duration > 0 ? a.media_duration : null;
  const position = typeof a?.media_position === 'number' ? a.media_position : null;
  if (duration === null || position === null) return null;
  const since = typeof a?.media_position_updated_at === 'string' ? Date.parse(a.media_position_updated_at) : NaN;
  const at = Math.max(0, Math.min(duration,
    position + (playing && Number.isFinite(since) ? Math.max(0, now - since) / 1000 : 0)));
  return {position: clock(at), duration: clock(duration), fraction: at / duration};
}

// The cover's tone (its average colour), for the light behind it; none when the picture cannot be read.
function useCoverTone(url: string | null) {
  const [tone, setTone] = useState<{url: string; hex: string} | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, 8, 8);
        const data = context.getImageData(0, 0, 8, 8).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if ((data[i + 3] ?? 0) < 128) continue;
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          n++;
        }
        if (!n || !live) return;
        const hex = (value: number) => Math.round(value / n).toString(16).padStart(2, '0');
        setTone({url, hex: `#${hex(r)}${hex(g)}${hex(b)}`});
      } catch {
        // A picture from another origin without CORS cannot be read: no light behind it.
      }
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return tone?.url === url ? tone.hex : null;
}

// The room's player column (A-Player): the room key on top, then the room's speaker as the player shows it.
export function RoomPlayer() {
  const {room, current} = useRoomPlayer();
  const [open, setOpen] = useState(false);
  const push = useNav(state => state.push);
  const entity = useEntity(current);
  const {model, lastKnown} = useShownPlayer(current ? entity : null, current ?? '');
  const play = useStore(commands.store, state => (current ? state.wishes[playKey(current)] : undefined));
  const skip = useStore(commands.store, state => (current ? state.wishes[skipKey(current)] : undefined));
  const volume = useStore(commands.store, state => (current ? state.wishes[volumeKey(current)] : undefined));
  const wished = play && (play.phase === 'sending' || play.phase === 'awaiting') ? (play.value as string) : null;
  const playing = (wished ?? model?.state) === 'playing';
  const progress = useProgress(lastKnown ? null : entity, playing);
  const tone = useCoverTone(model?.artwork ?? null);
  const picker = {
    label: room?.name ?? 'Vælg rum',
    'aria-label': `Rum: ${room?.name ?? 'intet valgt'} · Vælg rum`,
    onPress: () => {
      setOpen(true);
    },
  };
  const sheet = <RoomSheet isOpen={open} onClose={() => {
    setOpen(false);
  }} />;
  const findMusic = () => {
    push('find');
  };
  if (!room || !current) {
    return (
      <>
        <Player mode="idle" picker={picker} onFindMusic={findMusic} aria-label="Ingen højttaler i rummet"
          status="Home Assistant har ingen PodConnect-højttaler i dette område." />
        {sheet}
      </>
    );
  }
  if (!model) {
    return (
      <>
        <Player mode="offline" picker={picker} aria-label={`${current}: Ikke tilgængelig`}
          offline={{note: `Home Assistant har ingen tilstand for ${current} lige nu.`, retryLabel: 'Prøv igen',
            onRetry: () => {
              transport.resync();
            }}} />
        {sheet}
      </>
    );
  }
  const other = accountOf(entity) === 'other' && isActive(entity);
  const live = !lastKnown && model.available && !other;
  const shownVolume =
    volume && (volume.phase === 'sending' || volume.phase === 'awaiting') ? (volume.value as number) : model.volume;
  const status = lastKnown ? 'Sidst kendt · ikke tilgængelig lige nu' : other ? OTHER_ACCOUNT
    : STATE_LABEL[model.state];
  const radio = entity?.attributes.podconnect_source === 'radio';
  const mode = other ? 'other' : !model.title ? 'idle' : radio ? 'radio' : 'mine';
  const quiet = model.state === 'playing' || model.state === 'paused';
  return (
    <>
      <Player
        mode={mode}
        picker={picker}
        aria-label={`${model.name}: ${status}`}
        data-player-state={lastKnown ? 'last-known' : other ? 'other-account' : model.state}
        title={model.title}
        artist={other ? `${model.artist}${model.artist ? ' · ' : ''}en anden konto` : model.artist}
        cover={model.artwork}
        tone={tone}
        {...(lastKnown || !quiet ? {status: mode === 'idle' && model.state === 'off' ? 'Slukket' : status} : {})}
        progress={progress}
        playing={playing}
        busy={play?.phase === 'sending' || play?.phase === 'awaiting'}
        disabled={!live}
        onToggle={(playing ? model.can.pause : model.can.play) ? () => {
          media.playPause(current, !playing);
        } : null}
        onPrevious={model.can.previous ? () => {
          media.skip(current, 'previous');
        } : null}
        onNext={model.can.next ? () => {
          media.skip(current, 'next');
        } : null}
        onCover={() => {
          push('music');
        }}
        onFindMusic={findMusic}
        volume={model.can.volume || shownVolume !== null ? {
          value: shownVolume === null ? null : shownVolume * 100,
          disabled: !live || !model.can.volume,
          onCommit: value => {
            media.volume(current, value / 100);
          },
        } : null}
        radio={{station: model.title, line: 'Direkte radio', live: playing ? 'direkte' : 'stoppet'}}
        notice={wishNotice(play) || wishNotice(skip) || wishNotice(volume)}
      />
      {sheet}
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
    // The topbar's title is the screen's title (docs/PODVIEW-PARITY.md, decision 2): the heading is for assistive
    // technology only, and the screen has no page card of its own.
    <header className={cx('sr-only', className)}>
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
