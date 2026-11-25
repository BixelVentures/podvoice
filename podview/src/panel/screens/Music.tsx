// The room's music player: a PodConnect media_player in the room (HA area). Status is the speaker's own state as HA
// reports it; play/pause, next, previous, volume and mute are media_player.* on that entity. A tap shows its wish at
// once and never locks the controls; the speaker's next state confirms it, else the outcome is shown as unknown.
// While HA briefly has no state for the player (a restart, a resync) the last known track stays, marked as such.
// Another Spotify login playing in the room is shown, never controlled (the add-on's rule).
// Afspiller (design canvas Musik-Koe): the room's queue in the column, the player beside it. The room key on the
// player opens the room sheet: the rooms with what plays in each (the panel's old »Højttalere i hjemmet«), and
// »Afspil på« to move the music (docs/PODVIEW-PARITY.md decision 1).
import {skipToken, useQuery} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {create, useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {isMuted, lastKnownPlayers, media, muteKey, mutedLevels, playerModel, playKey, roomPlayer, seekKey,
  skipKey, volumeKey} from '../../lib/ha/media';
import type {PlayState} from '../../lib/ha/media';
import {findKey} from '../../lib/ha/find-music';
import type {AiShelf, FindItem} from '../../lib/ha/find-music';
import {accountOf, isActive, MOVE_KEY, music, ownMusicOf, sourceOf, START_KEY, useSpeakers}
  from '../../lib/ha/podconnect';
import {haKeys, transport, useCatalog, useEntities, useEntity} from '../../lib/ha/transport';
import {useNow} from '../../lib/hooks/clock';
import {useNav} from '../nav';
import {useRoom} from '../room';
import {wishNotice} from '../ui';
import {cx, Player, Sheet, SheetBody, SheetChoice, SheetSection, tv} from '../../ui';
import type {IdleRow, PlayerProps, SheetItem} from '../../ui';
import {Queue, useQueueRead} from './music-queue';
import {nameOf, OTHER_ACCOUNT, SpeakerChoice, usePickerContext, useQueuedChoice} from './music-speakers';
import {radio as radio_} from '../../lib/ha/radio';
import {useRadioNow} from './radio-now';
import type {RadioNow} from './radio-now';

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

// A speaker's card look (Radio's station card uses it).
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

// The room key's sheet (docs/PODVIEW-PARITY.md decision 1, the kit Sheet): the rooms (HA areas) as rows, each with
// what plays there right now (the panel's old multi-room screen »Højttalere i hjemmet«, folded in here) or what it has;
// the room's speakers when it has more than one; and »Afspil på« (moving the music, or choosing where the next start
// plays). A room choice shows at once and closes the sheet; the room is the page's (Hjem, Lys and the player follow).
function roomLine(player: HassEntityState | null, players: number, lights: number) {
  const title = typeof player?.attributes.media_title === 'string' ? player.attributes.media_title : '';
  if (player && title && sourceOf(player) === 'radio' && player.state === 'playing') return `Radio · ${title}`;
  if (player?.state === 'playing' && title) return `Spiller · ${title}`;
  if (player?.state === 'paused' && title) return `På pause · ${title}`;
  const count = (n: number, one: string, many: string) => (n ? `${String(n)} ${n === 1 ? one : many}` : '');
  return [count(players, 'højttaler', 'højttalere'), count(lights, 'lampe', 'lamper')].filter(Boolean).join(' · ')
    || 'Intet at vise';
}

function RoomSheet({isOpen, onClose}: {isOpen: boolean; onClose: () => void}) {
  const {room, players, states, current} = useRoomPlayer();
  const {rooms} = useRoom();
  const setRoom = useNav(state => state.setRoom);
  const all = rooms.flatMap(item => item.players);
  const allStates = useEntities(all);
  const stateOf = (id: string) => allStates[all.indexOf(id)] ?? null;
  const items: SheetItem<string>[] = rooms.map(item => {
    const player = roomPlayer(item.players.map(stateOf));
    return {id: item.id, name: item.name, detail: roomLine(player, item.players.length, item.lights.length),
      label: item.name, icon: 'house' as const};
  });
  return (
    <Sheet id="room-picker" isOpen={isOpen} onClose={onClose} title="Vælg rum"
      description="Skærmen viser rummets musik og lys.">
      <SheetBody>
      {/* Two parts, each with its own heading and glyph (G7 ruling): the rooms this screen can show (a house) and
          the speakers the music can play on (a speaker). */}
      <SheetSection id="room-rooms-title" title="Rum på denne skærm">
        <SheetChoice aria-label="Rum" items={items} value={room?.id ?? null} onChange={id => {
          setRoom(id);
          onClose();
        }} />
      </SheetSection>
      {room && players.length > 1 ? (
        <SheetSection id="room-speaker-title" title={`Højttaler i ${room.name}`}>
          <SheetChoice aria-label="Højttaler" value={current} onChange={id => {
            usePlayerChoice.setState(state => ({byRoom: {...state.byRoom, [room.id]: id}}));
          }} items={players.map((id, index) => {
            const entity = states[index] ?? null;
            return {id, name: nameOf(entity, id), detail: roomLine(entity, 0, 0)};
          })} />
        </SheetSection>
      ) : null}
      {current ? <SpeakerChoice from={current} onDone={onClose} /> : null}
      </SheetBody>
    </Sheet>
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
  return {position: clock(at), duration: clock(duration), fraction: at / duration, at, total: duration};
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

// Your own music playing in another room (the family's account, not radio): Player-AndetSted / Player-Optaget.
function useOwnMusicElsewhere(here: string | null): HassEntityState | null {
  const {rooms} = useRoom();
  const ids = rooms.flatMap(item => item.players).filter(id => id !== here);
  const states = useEntities(ids);
  return ownMusicOf(states);
}

function useRoomName(entityId: string | null): string {
  const {rooms} = useRoom();
  const entity = useEntity(entityId);
  return rooms.find(item => entityId && item.players.includes(entityId))?.name ?? nameOf(entity, entityId ?? '');
}

// The player's controls for one speaker: the transport, volume and the mute key on that entity.
function useControls(entityId: string | null) {
  const entity = useEntity(entityId);
  const {model, lastKnown} = useShownPlayer(entityId ? entity : null, entityId ?? '');
  const play = useStore(commands.store, state => (entityId ? state.wishes[playKey(entityId)] : undefined));
  const skip = useStore(commands.store, state => (entityId ? state.wishes[skipKey(entityId)] : undefined));
  const volume = useStore(commands.store, state => (entityId ? state.wishes[volumeKey(entityId)] : undefined));
  const mute = useStore(commands.store, state => (entityId ? state.wishes[muteKey(entityId)] : undefined));
  const seek = useStore(commands.store, state => (entityId ? state.wishes[seekKey(entityId)] : undefined));
  const remembered = useStore(mutedLevels, state => (entityId ? state.levels[entityId] : undefined));
  const pending = (wish: typeof play) => wish?.phase === 'sending' || wish?.phase === 'awaiting';
  const wished = pending(play) ? (play?.value as string) : null;
  const playing = (wished ?? model?.state) === 'playing';
  const progress = useProgress(lastKnown ? null : entity, playing);
  const shownVolume = pending(volume) ? (volume?.value as number) : model?.volume ?? null;
  const muted = pending(mute) ? mute?.value === true
    : isMuted(model && shownVolume !== model.volume ? {...model, volume: shownVolume} : model, remembered);
  return {entity, model, lastKnown, play, skip, volume, mute, seek, playing, progress, shownVolume, muted};
}

function transportProps(entityId: string, c: ReturnType<typeof useControls>, live: boolean):
  Partial<PlayerProps> {
  const model = c.model;
  if (!model) return {};
  const seeking = c.seek?.phase === 'sending' || c.seek?.phase === 'awaiting' ? (c.seek.value as number) : null;
  return {
    progress: c.progress,
    seek: model.can.seek && c.progress ? {value: seeking ?? c.progress.at, max: c.progress.total, disabled: !live,
      onCommit: seconds => {
        media.seek(entityId, seconds);
      }} : null,
    playing: c.playing,
    busy: c.play?.phase === 'sending' || c.play?.phase === 'awaiting',
    disabled: !live,
    onToggle: (c.playing ? model.can.pause : model.can.play) ? () => {
      media.playPause(entityId, !c.playing);
    } : null,
    onPrevious: model.can.previous ? () => {
      media.skip(entityId, 'previous');
    } : null,
    onNext: model.can.next ? () => {
      media.skip(entityId, 'next');
    } : null,
    volume: model.can.volume || c.shownVolume !== null ? {
      value: c.shownVolume === null ? null : c.shownVolume * 100,
      disabled: !live || !model.can.volume,
      onCommit: value => {
        media.volume(entityId, value / 100);
      },
      muted: c.muted,
      ...(live && (model.can.mute || model.can.volume) ? {onMute: () => {
        media.mute(entityId, !c.muted);
      }} : {}),
    } : null,
    notice: wishNotice(c.play) || wishNotice(c.skip) || wishNotice(c.volume) || wishNotice(c.mute) ||
      wishNotice(c.seek),
  };
}

// Player-Tom's rows (the »mellemting«, comments 44f38fb3 and 086b3b85): »Til eftermiddagen« (the period's AI pick,
// discoveryPeriod: before 11 »Godmorgen«, before 17 »Til eftermiddagen«, else »Til aftenen«) and »Hør igen« (the two
// latest tracks). Only what Find musik has already read is shown (the query cache): the empty player never makes a
// Spotify or AI call of its own (Spotify's shared quota, the AI budget), and a group without rows is left out. A tap
// starts it where the next start goes (Afspil på), as on Find musik; the AI never plays by itself.
function useIdleRows(destination: string | null): {label: string; rows: IdleRow[]}[] {
  const {weather} = useCatalog();
  const now = useNow();
  const recent = useQuery<FindItem[]>({queryKey: [...haKeys.read, 'shelf', 'recent'], queryFn: skipToken});
  const picks = useQuery<AiShelf[]>({queryKey: findKey('picks', weather[0] ?? ''), queryFn: skipToken});
  const start = useStore(commands.store, state => state.wishes[START_KEY]);
  const starting = start?.phase === 'sending' || start?.phase === 'awaiting' ? (start.value as string) : null;
  const hour = Number(new Date(now).toLocaleString('da-DK', {hour: 'numeric', hour12: false,
    timeZone: 'Europe/Copenhagen'}));
  const period = hour < 11 ? 'Godmorgen' : hour < 17 ? 'Til eftermiddagen' : 'Til aftenen';
  const shelf = picks.data?.find(item => item.id === 'ai_daypart') ?? picks.data?.find(item => item.id === 'ai_moment');
  const row = (item: FindItem, sub: string): IdleRow => ({
    title: item.name, sub, cover: item.artwork, label: `Afspil ${item.name}`, busy: starting === item.uri,
    onPress: () => {
      if (destination) music.start(destination, item.uri, item.kind === 'playlist' ? 'playlist' : 'music');
    },
  });
  return [
    {label: period, rows: shelf?.items.slice(0, 1).map(item => row(item, item.kind === 'playlist'
      ? 'Spotify-playliste' : item.byline ?? '')) ?? []},
    {label: 'Hør igen', rows: (recent.data ?? []).slice(0, 2).map(item => row(item, item.byline ?? ''))},
  ];
}

// The radio plays on this speaker (Speakers says so, the stop not yet asked).
function radioPlaysHere(now: RadioNow, entityId: string): boolean {
  return now.phase === 'spiller' && !now.stopping && now.current?.entity_id === entityId;
}

// The room's player column (A-Player): the room key on top, then the room's speaker as the player shows it. Its modes
// come from PodConnect's own facts on the room players (podconnect_account, podconnect_source):
// - mine: the room's speaker plays the family's music (or is paused there);
// - radio: it plays a station;
// - other: another Spotify login plays here (shown, never controlled; Player-AndenKonto), and while the family's own
//   music plays in another room, »Flyt … hertil« takes it here (Player-Optaget, one explicit tap);
// - away: nothing plays here while the family's music plays in another room (Player-AndetSted): the top is a plain
//   status line naming that room (no chevron, comment 4668f3ba), the controls act on that room, and »Flyt til
//   <rum>« moves it here;
// - idle and offline.
export function RoomPlayer() {
  const {room, current} = useRoomPlayer();
  const [open, setOpen] = useState(false);
  const push = useNav(state => state.push);
  const here = useControls(current);
  const elsewhereEntity = useOwnMusicElsewhere(current);
  const elsewhereId = elsewhereEntity?.entity_id ?? null;
  const away = useControls(elsewhereId);
  const elsewhereRoom = useRoomName(elsewhereId);
  const next = useSpeakers(state => state.nextDestination);
  const idleRows = useIdleRows(next ?? current);
  const move = useStore(commands.store, state => state.wishes[MOVE_KEY]);
  // A speaker choice queued during a warm-up or a start is made here: the player column is always mounted.
  useQueuedChoice(usePickerContext(current));
  const {entity, model, lastKnown} = here;
  const tone = useCoverTone((model?.title ? model.artwork : away.model?.artwork) ?? null);
  // The radio as Speakers reports it (radio-now.ts): the station's name and logo, starting or live, and its stop.
  const radioNow = useRadioNow();
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
  // Never »Sidst kendt« (G7 ruling): the speaker's last report stays shown and the line says what is true now.
  const status = lastKnown ? 'Ikke tilgængelig lige nu' : other ? OTHER_ACCOUNT
    : STATE_LABEL[model.state];
  // Radio plays here (the speaker says so), or a start is on its way to this speaker.
  const radio = entity?.attributes.podconnect_source === 'radio' ||
    (radioNow.phase === 'starter' && radioNow.destination?.entity_id === current);
  const idleHere = !isActive(entity) && !lastKnown;
  const moving = move?.phase === 'sending' || move?.phase === 'awaiting';
  const moveHere = () => {
    if (elsewhereId) music.move(elsewhereId, current);
  };
  // Away: the family's music plays in another room and nothing plays here.
  if (idleHere && !radio && elsewhereId && away.model) {
    const awayLive = !away.lastKnown && away.model.available;
    return (
      <>
        <Player
          mode="away"
          // The top names where the music plays (comment f6d4cd2d) and, as every room key, opens the sheet (G7 #10:
          // the room key is always active, which replaces comment 4668f3ba's plain line).
          picker={{...picker, label: elsewhereRoom, 'aria-label': `Spiller i ${elsewhereRoom} · Vælg rum`}}
          aria-label={`${away.model.name}: ${STATE_LABEL[away.model.state]}`}
          data-player-state="away"
          title={away.model.title}
          artist={away.model.artist}
          cover={away.model.artwork}
          tone={tone}
          {...transportProps(elsewhereId, away, awayLive)}
          away={{device: elsewhereRoom, moveLabel: moving ? 'Flytter …' : `Flyt til ${room.name}`, onMove: moveHere}}
          {...(wishNotice(move) ? {notice: wishNotice(move)} : {})}
        />
        {sheet}
      </>
    );
  }
  const mode = other ? 'other' : radio ? 'radio' : !model.title ? 'idle' : 'mine';
  const station = radioNow.station;
  const destination = radioNow.destination;
  const radioHere = radioPlaysHere(radioNow, current);
  const quiet = model.state === 'playing' || model.state === 'paused';
  // Player-Tom has no status line; only a speaker that is off, last known or another login says so.
  const takeOver = other && elsewhereId && away.model?.title ? {
    title: [away.model.title, away.model.artist].filter(Boolean).join(' · '),
    line: `Din musik · spiller i ${elsewhereRoom}`,
    label: moving ? 'Flytter …' : `Flyt ${away.model.title} hertil`,
    onPress: moveHere,
  } : null;
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
        {...(lastKnown || (!quiet && !(mode === 'idle' && model.state === 'idle'))
          ? {status: mode === 'idle' && model.state === 'off' ? 'Slukket' : status} : {})}
        {...transportProps(current, here, live)}
        {...(mode === 'radio' ? {
          playing: radioHere,
          busy: radioNow.stopping || radioNow.phase === 'starter',
          onToggle: radioHere ? () => {
            radio_.stop(radioNow.current);
          } : station && destination ? () => {
            radio_.start(station.id, destination);
          } : null,
        } : {})}
        onCover={() => {
          push('music');
        }}
        onFindMusic={findMusic}
        idleRows={idleRows}
        takeOver={takeOver}
        radio={{station: station?.name ?? model.title, logo: station?.logo ?? null, line: 'Direkte radio',
          live: radioNow.phase === 'starter' ? 'forbinder' : radioHere ? 'direkte' : 'stoppet'}}
        {...(wishNotice(move) && takeOver ? {notice: wishNotice(move)} : {})}
      />
      {sheet}
    </>
  );
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

// Afspiller (design canvas Musik-Koe): the room's queue in the column, the player fixed beside it (the shell's
// column). The cover opens it; the Kø key is gone everywhere (comment 22db6e19). Its »Find musik« key sits beside the
// Kø heading (G7 ruling), so the page is never a dead end.
export function MusicScreen() {
  const {room, current} = useRoomPlayer();
  return (
    <section id="music-view" className="flex h-full min-h-0 flex-1 flex-col" aria-labelledby="music-title">
      <ScreenHeading id="music-title" title="Afspiller"
        line={current ? `Kø · ${room?.name ?? ''}` : 'Ingen PodConnect-højttalere i Home Assistant'} />
      {current ? <Queue entityId={current} room={room?.name ?? ''} /> : null}
    </section>
  );
}
