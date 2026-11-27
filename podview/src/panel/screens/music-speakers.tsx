// »Afspil på«: the player's room key opens this one list of speakers (docs/PODVIEW-PARITY.md decision 1, the kit
// Sheet; the owner, 27 Nov: no rooms in it, the screen's own room is fixed per wall). Its rows are every PodConnect
// speaker HA has, each named by its room with the HomePod's name under it, as the old »Stuen ⌄«; each row's status is
// that speaker's own (HA's media_player, PodConnect Speakers' own availability, the last failed start). A tap is one explicit
// choice, made once (lib/ha/podconnect.ts speakerPicker): the music moves there, or it becomes the next start's
// destination while nothing plays, or it waits for the room's own state (warm-up) or for a start on its way.
import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {lastKnownPlayers} from '../../lib/ha/media';
import {accountOf, isActive, MOVE_KEY, ownMusic, speakers, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import type {PickerContext} from '../../lib/ha/podconnect';
import {RADIO_KEY, useRadio} from '../../lib/ha/radio';
import {useEntities, useEntity, useLink} from '../../lib/ha/transport';
import {useRoomCatalog} from '../../lib/ha/speaker-rooms';
import {cx, Notice as KitNotice, pressable, SheetRow} from '../../ui';
import {NOT_SENT_TEXT, Notice, wishNotice} from '../ui';

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

// Every PodConnect speaker HA has, with its room's name: the rooms' players, then those HA has not placed (null).
export function useAllSpeakers(): {id: string; room: string | null}[] {
  const catalog = useRoomCatalog();
  return [...catalog.rooms.flatMap(room => room.players.map(id => ({id, room: room.name}))),
    ...catalog.unplaced.players.map(id => ({id, room: null}))];
}

// The room a speaker is in, by PodConnect's room rules (else HA's area), or null.
export function useSpeakerRoom(entityId: string | null): string | null {
  const all = useAllSpeakers();
  return all.find(row => row.id === entityId)?.room ?? null;
}

// PodConnect's own readiness per room: PodConnect Speakers reports each room's availability with its media_player
// (podvoice.radio_state's targets, read for the radio anyway). A room it says is not available cannot start music
// (»Ikke klar«). Unknown (Speakers not read, or a speaker it does not list) is not »not ready«.
export function useNotReady(): ReadonlySet<string> {
  const {generation} = useLink();
  const {data} = useRadio(generation);
  const targets = data?.available ? data.targets : [];
  return new Set(targets.flatMap(row => (row.entity_id && !row.available ? [row.entity_id] : [])));
}

// A start that failed, where it was tapped (a Find musik shelf, the activity results, the idle player): the kit's
// error notice »Kunne ikke starte på <speaker>« (or »Ikke sendt« without a link), until the next tap.
export function useStartFailure(source?: string): string {
  const failed = useSpeakers(state => state.failed);
  if (!failed || (source !== undefined && failed.source !== source)) return '';
  return failed.sent ? `Kunne ikke starte på ${failed.name}` : NOT_SENT_TEXT;
}

export function StartFailed({source, className}: {source?: string; className?: string}) {
  const text = useStartFailure(source);
  if (!text) return null;
  return <KitNotice compact level="fejl" title={text} className={cx('self-start', className)} />;
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

// How long the ✓ stands on a chosen »Afspil på« row before the sheet closes.
export const AFSPIL_DONE_MS = 700;

// »Afspil på« (the sheet's one list, in the sheet's own rows): every PodConnect speaker HA has; a tap moves the music
// there, or makes it the next start's destination while nothing plays. The row answers on itself (G7 ruling): a move
// shows »Flytter…« with its dots until the speaker there plays it, then ✓, and the sheet closes (`onDone`); a
// destination is ✓ at once. A refused or unknown move stays open with the product's notice. A speaker PodConnect
// says is not available is »Ikke klar« and cannot be chosen; one whose start just failed says so and can be tried
// again.
export function SpeakerChoice({from, onDone, onChoose}: {from: string; onDone?: () => void;
  onChoose?: (id: string) => void}) {
  const context = usePickerContext(from);
  const rows = useAllSpeakers();
  const states = useEntities(rows.map(row => row.id));
  const notReady = useNotReady();
  const failedSpeakers = useSpeakers(state => state.failedSpeakers);
  const next = useSpeakers(state => state.nextDestination);
  const queued = useSpeakers(state => state.queued);
  const move = useStore(commands.store, state => state.wishes[MOVE_KEY]);
  // The choice this sheet made: a move answers on its row until the speaker there plays it (the wish ends), then ✓;
  // a destination is ✓ at once; a refused or unknown move (a notice) is no ✓ and leaves the sheet open.
  const [flight, setFlight] = useState<{to: string; moved: boolean} | null>(null);
  const other = accountOf(context.entity) === 'other' && isActive(context.entity);
  const moving = move && pending(move.phase) ? (move.value as string) : null;
  // A refused or unknown move forgets its row's answer (the notice says what happened).
  if (flight?.moved && move && !pending(move.phase)) setFlight(null);
  const done = !!flight && (!flight.moved || !move);
  useEffect(() => {
    if (!done || !onDone) return;
    const handle = window.setTimeout(onDone, AFSPIL_DONE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [done, onDone]);
  const note = other ? OTHER_ACCOUNT : queued ? 'Afventer bekræftelse af afspilningen.'
    : ownMusic(context.entity) ? 'Vælg en højttaler til den aktuelle afspilning.'
      : 'Vælg, hvor musikken skal spille, næste gang den startes.';
  return (
    <div className="flex flex-col gap-pv-s2">
      <div id="room-options" className="grid gap-pv-s2" role="group" aria-label="Højttalere">
        {rows.map(({id, room}, index) => {
          const entity = states[index] ?? null;
          const reachable = !!entity && entity.state !== 'unavailable' && entity.state !== 'unknown';
          const ready = reachable && !notReady.has(id);
          const failed = ready && !isActive(entity) && failedSpeakers.includes(id);
          const actual = id === context.from && ownMusic(entity);
          const chosen = queued ? queued.to === id : moving ? moving === id : next === id;
          const flying = flight?.to === id && moving === id;
          const confirmed = done && flight.to === id;
          const status = flying ? 'Flytter…' : confirmed ? (flight.moved ? 'Flyttet' : 'Valgt') : chosen ? 'Valgt'
            : actual ? 'Spiller nu' : '';
          const title = typeof entity?.attributes.media_title === 'string' ? entity.attributes.media_title : '';
          const state = !ready ? 'Ikke klar' : failed ? 'Kunne ikke starte · Prøv igen'
            : entity.state === 'playing' && title ? `Spiller · ${title}`
              : entity.state === 'paused' && title ? `På pause · ${title}` : '';
          const speaker = nameOf(entity, id);
          return (
            <SheetRow key={id} data-speaker-id={id} data-ready={ready ? 'true' : 'false'}
              data-failed={failed ? 'true' : undefined} name={room ?? speaker}
              detail={[room ? speaker : '', state].filter(Boolean).join(' · ')}
              {...(status ? {status} : {})} pending={flying} done={confirmed}
              chosen={chosen || confirmed || (!queued && !moving && !next && actual)} isDisabled={!ready || other}
              onPress={() => {
                const result = speakers.choose(id, context);
                onChoose?.(id);
                if (result === 'move') setFlight({to: id, moved: true});
                else if (result === 'destination' || result === 'here') setFlight({to: id, moved: false});
                else setFlight(null);
              }} />
          );
        })}
      </div>
      <p className="text-pv-body text-pv-ink-3" role="status" hidden={!note}>
        {note}
      </p>
      <Notice text={wishNotice(move)} />
    </div>
  );
}
