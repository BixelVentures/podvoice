// »Afspil på«: the speaker choice in the room sheet (docs/PODVIEW-PARITY.md decision 1, the kit Sheet). Its rows are
// every PodConnect room HA has; each row's status is that speaker's own (HA's media_player). A tap is one explicit
// choice, made once (lib/ha/podconnect.ts speakerPicker): the music moves there, or it becomes the next start's
// destination while nothing plays, or it waits for the room's own state (warm-up) or for a start on its way.
import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {lastKnownPlayers} from '../../lib/ha/media';
import {accountOf, isActive, MOVE_KEY, ownMusic, speakers, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import type {PickerContext} from '../../lib/ha/podconnect';
import {RADIO_KEY} from '../../lib/ha/radio';
import {useEntities, useEntity} from '../../lib/ha/transport';
import {useRoomCatalog} from '../../lib/ha/speaker-rooms';
import {cx, pressable, SheetRow, SheetSection} from '../../ui';
import {Notice, wishNotice} from '../ui';

export const OTHER_ACCOUNT = 'En anden Spotify-konto spiller her';

// A speaker (or station) to choose: icon, name and availability, and its status at the end. The chosen one is
// ringed on the surface (aria-pressed).
export const TARGET_ROW = cx(pressable, 'grid min-h-24 w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center',
  'gap-pv-s2 rounded-pv-l bg-pv-surface-2 p-pv-s2 text-left text-pv-body text-pv-ink',
  'aria-pressed:bg-pv-surface aria-pressed:shadow-[inset_0_0_0_2px_var(--color-pv-ink)]');

export function TargetCopy({name, detail, status, icon}: {name: string; detail: string; status: string;
  icon: ReactNode}) {
  return (
    <>
      {icon}
      <span className="grid min-w-0 gap-pv-s1">
        <strong className="truncate text-pv-label font-semibold">{name}</strong>
        <small className="text-pv-meta text-pv-ink-3">{detail}</small>
      </span>
      <span className="truncate text-right text-pv-meta">{status}</span>
    </>
  );
}

const pending = (phase: string | undefined) => phase === 'sending' || phase === 'awaiting';

export const nameOf = (entity: HassEntityState | null, entityId: string) => {
  const name = entity?.attributes.friendly_name;
  return typeof name === 'string' && name ? name : entityId;
};

// Every PodConnect speaker HA has: the rooms' players, then those HA has not placed.
export function useAllSpeakers(): string[] {
  const catalog = useRoomCatalog();
  return [...catalog.rooms.flatMap(room => room.players), ...catalog.unplaced.players];
}

// What a choice needs to know about the full player's speaker right now.
export function usePickerContext(from: string | null): PickerContext {
  const entity = useEntity(from);
  const last = useStore(lastKnownPlayers, state => (from ? state.models[from] : undefined));
  const starting = useStore(commands.store, state =>
    pending(state.wishes[START_KEY]?.phase) || pending(state.wishes[RADIO_KEY]?.phase));
  return {
    from,
    entity,
    lastKnownActive: !!last && (last.state === 'playing' || last.state === 'paused'),
    starting,
  };
}

// A choice queued during a warm-up or a start is made once, as soon as its moment comes (and dropped after 30 s).
export function useQueuedChoice(context: PickerContext) {
  const queued = useSpeakers(state => state.queued);
  const {from, entity, lastKnownActive, starting} = context;
  useEffect(() => {
    if (!queued) return;
    speakers.runQueued({from, entity, lastKnownActive, starting});
    if (queued.warmup) return;
    const timer = window.setTimeout(() => {
      speakers.runQueued({from, entity: null, lastKnownActive: false, starting: true});
    }, Math.max(0, queued.at + 30_000 - Date.now()) + 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [queued, from, entity, lastKnownActive, starting]);
}

// »Afspil på« (the room sheet's second part, in the sheet's own rows): every PodConnect speaker HA has; a tap moves
// the music there, or makes it the next start's destination while nothing plays. A choice keeps the sheet open (another
// tap is the newer choice).
export function SpeakerChoice({from}: {from: string}) {
  const context = usePickerContext(from);
  const ids = useAllSpeakers();
  const states = useEntities(ids);
  const next = useSpeakers(state => state.nextDestination);
  const queued = useSpeakers(state => state.queued);
  const move = useStore(commands.store, state => state.wishes[MOVE_KEY]);
  const other = accountOf(context.entity) === 'other' && isActive(context.entity);
  const moving = move && pending(move.phase) ? (move.value as string) : null;
  const note = other ? OTHER_ACCOUNT : queued ? 'Afventer bekræftelse af afspilningen.'
    : ownMusic(context.entity) ? 'Vælg en højttaler til den aktuelle afspilning.'
      : 'Vælg, hvor musikken skal spille, næste gang den startes.';
  return (
    <SheetSection id="room-options-title" title="Afspil på">
      <div id="room-options" className="grid gap-pv-s2" role="group" aria-label="Højttalere">
        {ids.map((id, index) => {
          const entity = states[index] ?? null;
          const available = !!entity && entity.state !== 'unavailable' && entity.state !== 'unknown';
          const actual = id === context.from && ownMusic(entity);
          const chosen = queued ? queued.to === id : moving ? moving === id : next === id;
          const status = chosen ? 'Valgt' : actual ? 'Aktuelt output' : '';
          const title = typeof entity?.attributes.media_title === 'string' ? entity.attributes.media_title : '';
          const detail = !available ? 'Ikke tilgængelig' : entity.state === 'playing' && title ? `Spiller · ${title}`
            : entity.state === 'paused' && title ? `På pause · ${title}` : 'Klar';
          return (
            <SheetRow key={id} data-speaker-id={id} name={nameOf(entity, id)} detail={detail}
              {...(status ? {status} : {})}
              chosen={chosen || (!queued && !moving && !next && actual)} isDisabled={!available || other}
              onPress={() => {
                speakers.choose(id, context);
              }} />
          );
        })}
      </div>
      <p className="text-pv-body text-pv-ink-3" role="status" hidden={!note}>
        {note}
      </p>
      <Notice text={wishNotice(move)} />
    </SheetSection>
  );
}
