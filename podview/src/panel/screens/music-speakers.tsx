// Højttalere: the speaker picker of the full player (the PodView sheet »Afspil på«) on React Aria's overlay hooks.
// Its rows are every PodConnect room HA has; each row's status is that speaker's own (HA's media_player). A tap is
// one explicit choice, made once (lib/ha/podconnect.ts speakerPicker): the music moves there, or it becomes the next
// start's destination while nothing plays, or it waits for the room's own state (warm-up) or for a start on its way.
import {motion, useReducedMotion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {FocusScope, mergeProps, Overlay, useDialog, useOverlay} from 'react-aria';
import {useStore} from 'zustand';
import {commands} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {lastKnownPlayers} from '../../lib/ha/media';
import {accountOf, isActive, MOVE_KEY, ownMusic, speakers, START_KEY, useSpeakers} from '../../lib/ha/podconnect';
import type {PickerContext} from '../../lib/ha/podconnect';
import {RADIO_KEY} from '../../lib/ha/radio';
import {useEntities, useEntity} from '../../lib/ha/transport';
import {useRoomCatalog} from '../../lib/ha/speaker-rooms';
import {TRANSITION} from '../../lib/motion/tokens';
import {KitButton} from '../../lib/ui/KitButton';
import {icon, Notice, wishNotice} from '../ui';

export const OTHER_ACCOUNT = 'En anden Spotify-konto spiller her';
const ROW_CLASS = 'pv-row pv-btn pv-kit pv-kit-listrow';
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

function SpeakerRows({ids, context}: {ids: string[]; context: PickerContext}) {
  const states = useEntities(ids);
  const next = useSpeakers(state => state.nextDestination);
  const queued = useSpeakers(state => state.queued);
  const move = useStore(commands.store, state => state.wishes[MOVE_KEY]);
  const other = accountOf(context.entity) === 'other' && isActive(context.entity);
  const moving = move && pending(move.phase) ? (move.value as string) : null;
  return ids.map((id, index) => {
    const entity = states[index] ?? null;
    const available = !!entity && entity.state !== 'unavailable' && entity.state !== 'unknown';
    const actual = id === context.from && ownMusic(entity);
    const chosen = queued ? queued.to === id : moving ? moving === id : next === id;
    const status = chosen ? 'Valgt' : actual ? 'Aktuelt output' : '';
    const name = nameOf(entity, id);
    return (
      <KitButton
        key={id}
        className={ROW_CLASS}
        data-kit="listrow"
        data-speaker-id={id}
        aria-pressed={chosen || (!queued && !moving && !next && actual)}
        aria-label={[name, status].filter(Boolean).join(' · ')}
        isDisabled={!available || other}
        onPress={() => {
          speakers.choose(id, context);
        }}
      >
        <img src={icon('speaker-output')} alt="" />
        <span>
          <strong>{name}</strong>
          <small>{available ? 'Tilgængelig' : 'Ikke tilgængelig'}</small>
        </span>
        <span className="target-status">{status}</span>
      </KitButton>
    );
  });
}

// The sheet itself: React Aria's dialog, focus scope and dismissal (Escape, a tap outside, »Luk«). It is not a modal
// <dialog> and makes nothing inert: the page behind stays as it is, the sheet only covers it.
function Sheet({onClose, children}: {onClose: () => void; children: ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;
  const {overlayProps, underlayProps} = useOverlay({isOpen: true, onClose, isDismissable: true}, ref);
  const {dialogProps, titleProps} = useDialog({'aria-labelledby': 'room-title'}, ref);
  return (
    <motion.div
      className="pv-panel-overlay"
      {...(underlayProps as object)}
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      transition={reduced ? TRANSITION.reduced : TRANSITION.quick}
    >
      <FocusScope contain restoreFocus autoFocus>
        <motion.div
          {...(mergeProps(overlayProps, dialogProps) as object)}
          ref={ref}
          id="rooms"
          aria-modal="true"
          className="pv-kit pv-kit-dialog pv-panel-sheet"
          data-kit="dialog"
          initial={reduced ? {opacity: 0} : {opacity: 0, transform: 'translate3d(0, 24px, 0)'}}
          animate={{opacity: 1, transform: 'translate3d(0, 0, 0)'}}
          transition={reduced ? TRANSITION.reduced : TRANSITION.smooth}
        >
          <header className="pv-dialog-header">
            <h2 {...titleProps} id="room-title">
              Afspil på
            </h2>
            <KitButton className="dialog-close pv-dialog-close" aria-label="Luk" onPress={onClose}>
              <img src={icon('x-lg')} alt="" />
            </KitButton>
          </header>
          {children}
        </motion.div>
      </FocusScope>
    </motion.div>
  );
}

export function SpeakerSheet({
  isOpen,
  onOpenChange,
  from,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  from: string;
}) {
  const context = usePickerContext(from);
  const [host, setHost] = useState<Element | null>(null);
  const ids = useAllSpeakers();
  const queued = useSpeakers(state => state.queued);
  const move = useStore(commands.store, state => state.wishes[MOVE_KEY]);
  const other = accountOf(context.entity) === 'other' && isActive(context.entity);
  const note = other ? OTHER_ACCOUNT : queued ? 'Afventer bekræftelse af afspilningen.'
    : ownMusic(context.entity) ? 'Vælg en højttaler til den aktuelle afspilning.' : '';
  return (
    <>
      <span
        ref={node => {
          setHost(node?.closest('pv-widget-host') ?? null);
        }}
        hidden
      />
      {/* Drawn inside the PodView frame (its stylesheet's scope), never on HA's own document. */}
      {isOpen ? (
        <Overlay {...(host ? {portalContainer: host} : {})}>
          <Sheet
            onClose={() => {
              onOpenChange(false);
            }}
          >
            <p>Vælg højttaler til din musik.</p>
            <div id="room-options" className="pv-dialog-content" role="group" aria-label="Højttalere">
              <SpeakerRows ids={ids} context={context} />
            </div>
            <p className="screen-explanation" role="status" hidden={!note}>
              {note}
            </p>
            <Notice text={wishNotice(move)} />
          </Sheet>
        </Overlay>
      ) : null}
    </>
  );
}
