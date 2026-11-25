// Robotstøvsuger (the design canvas's A-Robot, Robot-Rengoer/Pause/TilBasen/Fejl/Ukendt/Mere/Basen-*, Robot-Sticky*;
// DECISIONS §11): the household's vacuums from the PodVoice integration (podvoice.robot_panel_state; lib/ha/robot.ts)
// and their live HA entities. The hero says the state as a big title over the robot's arcs (still at rest, breathing
// while it works, broken on a fault), with at most two keys: the primary (Start, Pause or Fortsæt, as the state
// admits) and »Mere ▾«, whose fold holds what else is possible right now (Kør til basen, Afslut rengøring). When the
// hero scrolls away, a sticky line under the topbar repeats the state and both keys. The transport is what HA's state
// and feature bits admit, as the add-on's direct transport offered it: Pause/Fortsæt at once, Kør til basen and
// Afslut rengøring after the kit's confirmation. A tap is shown at once, sent once, and the vacuum's next state is its
// proof; nothing is locked or resent. Rooms, settings, events and care are robot-cleaning.tsx.
import {useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {create, useStore} from 'zustand';
import {useNow} from '../../lib/hooks/clock';
import {robotExperience, robotLabel, robotRoom, robotDetailMetadata, robotValue} from '../../lib/robot/observation';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {
  cleaningQuery, robotWishKey, startWishKey, transportActions, useRobotCleaningCommands, useRobotCommands,
  useRobotState,
} from '../../lib/ha/robot';
import type {RobotAction, RobotRow} from '../../lib/ha/robot';
import {useEntity, useLink} from '../../lib/ha/transport';
import {
  ActionDrawer, ActionMenu, Button, Dialog, Fresh, freshText, Hero, HeroArcs, MoreKey, ProgressCells, Segment,
  StatusHero, StickyLine, Widget,
} from '../../ui';
import type {HeroTitleTone, MenuGroup, ShownNotice, WidgetState} from '../../ui';
import {useNav} from '../nav';
import {useStickyHero} from '../sticky';
import {NOT_SENT_TEXT, UNKNOWN_TEXT, wishNotice} from '../ui';
import {
  EventsSection, OptionsSection, restNote, RoomsSection, startOffer, ThisTrip, UNKNOWN_START, useCleaning,
  useDraft,
} from './robot-cleaning';
import type {CleaningView} from './robot-cleaning';

// HA's vacuum states as the old screen's device statuses.
const STATUS: Record<string, string> = {
  cleaning: 'cleaning',
  paused: 'paused',
  returning: 'docking',
  docked: 'docked',
  idle: 'stopped',
  error: 'fault',
  unavailable: 'unavailable',
  unknown: 'unknown',
};
const pending = (wish: Wish | undefined) => wish?.phase === 'sending' || wish?.phase === 'awaiting';

export interface RobotDevice {
  kind: 'vacuum';
  live: true;
  status: string;
  stale: boolean;
  observedAt: number | null;
  telemetry: {status: 'observed'; items: RobotRow['telemetry']};
  pending: null;
}

// The old screen's device object, from the integration's read and HA's live vacuum state.
export function robotDevice(row: RobotRow, vacuum: HassEntityState | null, connected: boolean): RobotDevice {
  const state = vacuum?.state ?? row.state;
  return {
    kind: 'vacuum',
    live: true,
    status: STATUS[state] ?? 'unknown',
    stale: !connected,
    observedAt: row.observedAt,
    telemetry: {status: 'observed', items: row.telemetry},
    pending: null,
  };
}

// The robot shown: the one chosen on the screen, else the first vacuum HA has (the integration sorts by entity id).
export const useRobotChoice = create<{entityId: string | null}>(() => ({entityId: null}));

function useRobot() {
  const link = useLink();
  const read = useRobotState(link.generation);
  const chosen = useRobotChoice(state => state.entityId);
  const robots = read.data?.robots ?? [];
  const row = robots.find(robot => robot.entityId === chosen) ?? robots[0] ?? null;
  const vacuum = useEntity(row?.entityId ?? null);
  return {link, read, row, vacuum, robots};
}

// The page keeps Robot's reads warm from its start, as it does Svar's: the vacuum list (pushed; also the Home tile's)
// and the shown robot's cleaning state (rooms, settings, recipes), read at start and when the vacuum's state changes.
// Robot's first frame is then the robot, never »Henter«; nothing is polled while Robot is closed.
export function RobotPrefetch() {
  const {generation} = useLink();
  const client = useQueryClient();
  const read = useRobotState(generation);
  const chosen = useRobotChoice(state => state.entityId);
  const robots = read.data?.robots ?? [];
  const entityId = (robots.find(robot => robot.entityId === chosen) ?? robots[0] ?? null)?.entityId ?? null;
  const state = useEntity(entityId)?.state ?? null;
  useEffect(() => {
    if (entityId) void client.query(cleaningQuery(entityId, generation)).catch(() => undefined);
  }, [client, entityId, generation, state]);
  return null;
}

// ---- The robot's state as the canvas shows it ---------------------------------------------------------------------

export type RobotLook = 'oplader' | 'rengoer' | 'pause' | 'tilbasen' | 'fejl' | 'ukendt';

/** The canvas state of a robot (K-Widget robot, A-Robot): a fault before anything else, no link is unknown. */
export function robotLook(state: string, connected: boolean): RobotLook {
  if (!connected) return 'ukendt';
  return ({docked: 'oplader', idle: 'oplader', cleaning: 'rengoer', paused: 'pause', returning: 'tilbasen',
    error: 'fejl'} as Record<string, RobotLook | undefined>)[state] ?? 'ukendt';
}

// The Home widget's content: the robot's own label (as the Robot screen says it), its battery, »+N« for the other
// vacuums HA has, and the direct Pause/Fortsæt the state admits. '' while the first read runs, and null when HA has
// no vacuum or the integration cannot be read: hide the tile then.
export function useRobotWidget() {
  const {link, read, row, vacuum, robots} = useRobot();
  const now = useNow() / 1000;
  if (!row) return read.isPending && link.connected ? {state: 'ukendt' as const, prim: '', battery: '', more: 0,
    row: null, vacuum: null} : null;
  const device = robotDevice(row, vacuum, link.connected);
  const battery = row.telemetry.find(item => item.key === 'battery');
  const state: WidgetState<'robot'> = robotLook(vacuum?.state ?? row.state, link.connected);
  return {
    state,
    prim: robotLabel(device, now),
    battery: typeof battery?.value === 'number' ? `${String(Math.round(battery.value))} %` : '',
    more: Math.max(0, robots.length - 1),
    row,
    vacuum,
  };
}

export function RobotTile() {
  const widget = useRobotWidget();
  const push = useNav(state => state.push);
  const send = useRobotCommands();
  if (widget === null) return null;
  const {row, vacuum} = widget;
  const state = vacuum?.state ?? row?.state ?? '';
  const features = typeof vacuum?.attributes.supported_features === 'number'
    ? vacuum.attributes.supported_features : (row?.supportedFeatures ?? null);
  const admitted = transportActions(state, features);
  const direct = admitted.includes('pause') ? 'pause' : admitted.includes('resume') ? 'resume' : null;
  return (
    <Widget
      id="home-robot"
      kind="robot"
      state={widget.state}
      opens="robot"
      prim={widget.prim}
      ctx={widget.battery ? `Batteri ${widget.battery}` : ''}
      more={widget.more}
      {...(widget.state === 'fejl' ? {alert: 'error' as const} : {})}
      {...(direct && row ? {action: {label: direct === 'pause' ? 'Pause' : 'Fortsæt', onPress: () => {
        send(row, vacuum, direct);
      }}} : {})}
      onPress={() => {
        push('robot');
      }}
    />
  );
}

// With more than one vacuum in HA: a segmented choice of the robot shown (nothing extra with one).
function RobotChoice({robots, shown}: {robots: RobotRow[]; shown: string}) {
  if (robots.length < 2) return null;
  return (
    <Segment aria-label="Robotstøvsuger" value={shown}
      options={robots.map(robot => ({id: robot.entityId, label: robot.name}))}
      onChange={entityId => {
        useRobotChoice.setState({entityId});
      }} />
  );
}

interface HeroModel {
  look: RobotLook;
  eyebrow: string;
  title: string;
  titleTone: HeroTitleTone;
  sub: string;
  issue: ShownNotice | null;
  progress: number | null;
  fresh: string | null;
}

// The hero's words: the eyebrow is where the robot is or what it does (the cleaning type), the title its state, the
// line under it the product's facts (room, battery, area, time); a reported issue is the compact notice instead.
function heroModel(row: RobotRow, vacuum: HassEntityState | null, connected: boolean, live: Record<string,
  string | null>, now: number): HeroModel {
  const device = robotDevice(row, vacuum, connected);
  const state = vacuum?.state ?? row.state;
  const look = robotLook(state, connected);
  const experience = robotExperience(device, now);
  const issue = experience.issues[0];
  const meta = robotDetailMetadata(device, now);
  const room = robotRoom(device, now);
  const mode = live.cleaning_mode ? robotValue({key: 'cleaning_mode', value: live.cleaning_mode}) : '';
  const observed = row.observedAt ?? (vacuum ? Date.parse(vacuum.last_updated) / 1000 : null);
  const fresh = observed ? freshText(observed * 1000, now * 1000) : null;
  const progressRow = row.telemetry.find(item => item.key === 'clean_percent');
  const progress = look === 'rengoer' && progressRow?.stale !== true && typeof progressRow?.value === 'number'
    ? progressRow.value : null;
  const level = look === 'fejl' ? 'fejl' : 'handling';
  const shown: ShownNotice | null = issue ? {id: `${issue.key}:${issue.title}`, level, title: issue.title,
    ...(look === 'fejl' ? {text: issue.help} : {})} : null;
  switch (look) {
    case 'oplader':
      return {look, eyebrow: state === 'docked' ? 'Ved basen' : 'Robotstøvsuger',
        title: experience.activity ?? (state === 'docked' ? 'I basen' : 'Ingen aktiv rengøring'), titleTone: 'ink',
        sub: meta, issue: shown, progress: null, fresh};
    case 'rengoer':
      return {look, eyebrow: mode || 'Rengøring', title: 'Rengør', titleTone: 'ink',
        sub: [room ? `I ${room}` : '', meta].filter(Boolean).join(' · '), issue: shown, progress, fresh};
    case 'pause':
      return {look, eyebrow: mode || 'Rengøring', title: 'På pause', titleTone: 'ink', sub: meta, issue: shown,
        progress: null, fresh};
    case 'tilbasen':
      return {look, eyebrow: 'Kør til basen', title: 'Til basen', titleTone: 'ink', sub: 'Robotten sendes til basen.',
        issue: shown, progress: null, fresh};
    case 'fejl':
      return {look, eyebrow: 'Robotfejl', title: issue?.title ?? 'Robotten melder en fejl', titleTone: 'danger',
        sub: issue ? 'Robotten melder en fejl' : meta, issue: issue ? {id: issue.key, level: 'fejl', title: issue.help}
          : null,
        progress: null, fresh};
    case 'ukendt':
      return {look, eyebrow: 'Robotstøvsuger', title: 'Status ukendt', titleTone: 'muted', sub: meta,
        issue: {id: 'ukendt', level: 'info', title: 'Effekten af en kommando kan ikke bekræftes, før robotten svarer'},
        progress: null, fresh};
  }
}

// The newest unconfirmed command for this robot (transport or start), as the hero's compact notice.
function commandNotice(wish: Wish | undefined): ShownNotice | null {
  const text = wishNotice(wish);
  if (!wish || !text) return null;
  const level = text === NOT_SENT_TEXT || text === UNKNOWN_TEXT ? 'info' : 'fejl';
  return {id: `${wish.key}:${String(wish.seq)}`, level, title: text};
}

const CONFIRM = {
  return: {title: 'Kør til basen?', description: 'Robotten sendes til basen.', cancel: 'Behold turen',
    confirm: 'Kør til basen', variant: 'primaer'},
  stop: {title: 'Afslut rengøringen?', description: 'Rengøringen afsluttes. Robotten sendes ikke til basen. Brug ' +
    'Pause, hvis du vil fortsætte senere.', cancel: 'Behold turen', confirm: 'Afslut rengøring', variant: 'fare'},
} as const;

function RobotView({row, vacuum, robots, link}: {
  row: RobotRow;
  vacuum: HassEntityState | null;
  robots: RobotRow[];
  link: ReturnType<typeof useLink>;
}) {
  const now = useNow() / 1000;
  const connected = link.connected;
  const view: CleaningView = useCleaning(row.entityId, vacuum, link.generation);
  const {cleaning, live, rest} = view;
  const draft = useDraft(row.entityId);
  const send = useRobotCommands();
  const {start} = useRobotCleaningCommands();
  const transportWish = useStore(commands.store, state => state.wishes[robotWishKey(row.entityId)]);
  const startWish = useStore(commands.store, state => state.wishes[startWishKey(row.entityId)]);
  const [asking, setAsking] = useState<'return' | 'stop' | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const {heroRef, past, main} = useStickyHero(() => {
    setMenuOpen(false);
  });

  const model = heroModel(row, vacuum, connected, live, now);
  const state = vacuum?.state ?? row.state;
  const features = typeof vacuum?.attributes.supported_features === 'number'
    ? vacuum.attributes.supported_features : row.supportedFeatures;
  const admitted = transportActions(state, features);
  const busy = pending(transportWish) ? (transportWish?.value as RobotAction) : null;
  const offer = cleaning && rest ? startOffer(cleaning, live, draft) : null;
  const press = (action: RobotAction) => {
    if (action === 'return' || action === 'stop') setAsking(action);
    else send(row, vacuum, action);
  };
  const startPress = () => {
    if (cleaning && offer?.request) start(cleaning, vacuum, offer.request);
  };
  // The primary follows the state: Pause while it cleans, Fortsæt on pause, Start at rest (when it can be started).
  const transportPrimary = admitted.includes('pause') ? 'pause' : admitted.includes('resume') ? 'resume' : null;
  const primary = transportPrimary
    ? {id: transportPrimary, label: transportPrimary === 'pause' ? 'Pause' : 'Fortsæt',
      onPress: () => {
        press(transportPrimary);
      }, busy: busy === transportPrimary, disabled: !connected}
    : offer && cleaning?.startable
      ? {id: 'start', label: offer.label, onPress: startPress, busy: pending(startWish),
        disabled: !connected || offer.request === null}
      : null;
  const groups: MenuGroup[] = [];
  // Canvas order: Kør til basen, then Afslut rengøring (danger).
  const transport = (['return', 'stop'] as const).filter(action => admitted.includes(action));
  if (transport.length) {
    groups.push({id: 'transport', title: 'Rengøring', actions: transport.map(action => ({
      id: action, label: action === 'return' ? 'Kør til basen' : 'Afslut rengøring',
      tone: action === 'stop' ? 'fare' as const : 'plain' as const, busy: busy === action, isDisabled: !connected,
      onPress: () => {
        press(action);
      },
    }))});
  }
  const notice = commandNotice(startWish?.seq && (transportWish?.seq ?? 0) < startWish.seq ? startWish
    : transportWish) ?? (cleaning?.blocked ? {id: 'blocked', level: 'handling' as const, title: UNKNOWN_START}
    : model.issue);
  const primaryKey = (size: 56 | 44) => primary ? (
    <Button variant={model.look === 'ukendt' ? 'lys' : 'primaer'} size={size} data-action-id={primary.id}
      busy={primary.busy} isDisabled={primary.disabled} onPress={primary.onPress}>
      {primary.label}
    </Button>
  ) : null;
  const ask = asking ? CONFIRM[asking] : null;
  return (
    <>
      <RobotChoice robots={robots} shown={row.entityId} />
      <StatusHero ref={heroRef} variant="robot" id="robot-hero" data-resource-status={STATUS[state] ?? 'unknown'}
        surface={['rengoer', 'pause', 'tilbasen'].includes(model.look) ? 'robotActive' : 'robot'}
        aria-label={`${row.name}: ${model.title}`}
        art={<HeroArcs broken={model.look === 'fejl'} running={['rengoer', 'tilbasen'].includes(model.look)}
          className={HERO_ART[model.look]} />}
        eyebrow={model.eyebrow} corner={model.fresh ? <Fresh text={model.fresh} /> : null}
        title={model.title} titleTone={model.titleTone} sub={model.sub} notice={notice}
        footer={(
          <div className="flex flex-row-reverse items-center justify-start gap-3">
            {primaryKey(56)}
            {groups.length ? <MoreKey isExpanded={moreOpen} controls="robot-more" onPress={() => {
              setMoreOpen(open => !open);
            }} /> : null}
            {model.progress !== null ? (
              <div className="ml-3"><ProgressCells percent={model.progress}
                label={`${model.progress.toLocaleString('da-DK', {maximumFractionDigits: 1})} %`} /></div>
            ) : null}
          </div>
        )} />
      <ActionDrawer id="robot-more" groups={groups} isOpen={moreOpen && groups.length > 0} />
      {cleaning ? (
        <>
          {rest && cleaning.startable ? <RoomsSection cleaning={cleaning} live={live} connected={connected} rest />
            : null}
          {rest && !cleaning.startable && cleaning.reason ? (
            <p className="m-0 px-1 text-[15px] text-pv-ink-3" role="status">{restNote(cleaning)}</p>
          ) : null}
          {!rest && ['cleaning', 'paused', 'returning'].includes(state) ? (
            <ThisTrip cleaning={cleaning} row={row} room={robotRoom(robotDevice(row, vacuum, connected), now)} />
          ) : null}
          {(rest && cleaning.startable) || ['cleaning', 'paused', 'returning'].includes(state) ? (
            <OptionsSection cleaning={cleaning} live={live} connected={connected} rest={rest} />
          ) : null}
          <EventsSection cleaning={cleaning} telemetry={row.telemetry} connected={connected} rest={rest} />
        </>
      ) : view.read.isPending ? (
        <p className="m-0 px-1 text-[15px] text-pv-ink-3" role="status">Henter aktuel betjening…</p>
      ) : null}
      {main ? createPortal(
        <div className="pointer-events-none absolute top-0 left-0 z-[3] w-[736px]">
          <StickyLine isShown={past} surface="robot" label="Robotstøvsuger, handlinger"
            className="pointer-events-auto"
            dot={model.look === 'fejl' ? 'danger' : model.look === 'ukendt' ? 'grey' : 'robot'}
            title={model.title} sub={[model.eyebrow, model.sub].filter(Boolean).join(' · ')}
            primary={primaryKey(44)}
            more={groups.length ? <MoreKey size={44} isExpanded={menuOpen} controls="robot-sticky-more"
              onPress={() => {
                setMenuOpen(open => !open);
              }} /> : null} />
          <div className="pointer-events-auto absolute top-20 right-0">
            <ActionMenu id="robot-sticky-more" groups={groups} isOpen={past && menuOpen} />
          </div>
        </div>, main) : null}
      <Dialog isOpen={ask !== null} title={ask?.title ?? ''} description={ask?.description ?? ''}
        cancelLabel={ask?.cancel ?? ''} confirmLabel={ask?.confirm ?? ''} confirmVariant={ask?.variant ?? 'primaer'}
        confirmDisabled={!connected}
        onCancel={() => {
          setAsking(null);
        }}
        onConfirm={() => {
          const action = asking;
          setAsking(null);
          setMoreOpen(false);
          setMenuOpen(false);
          if (action) send(row, vacuum, action);
        }} />
    </>
  );
}

// The arcs' tone per state (K-Widget robot: the robot's dot red, grey on a fault or when unknown).
const HERO_ART: Record<RobotLook, string> = {
  oplader: 'fill-pv-robot-dot opacity-55',
  rengoer: 'fill-pv-robot-dot',
  pause: 'fill-pv-robot-dot opacity-70',
  tilbasen: 'fill-pv-robot-dot opacity-80',
  fejl: 'fill-pv-grey opacity-45',
  ukendt: 'fill-pv-grey opacity-35',
};

export function RobotScreen() {
  const {link, read, row, vacuum, robots} = useRobot();
  if (!row) {
    const loading = read.isPending && link.connected;
    return (
      <section id="robot-view" className="flex flex-col gap-8 pb-6" aria-labelledby="robot-title">
        <h1 id="robot-title" className="sr-only">Robotstøvsuger</h1>
        {loading ? (
          <p className="m-0 px-1 text-[15px] text-pv-ink-3" role="status">Henter aktuel betjening…</p>
        ) : (
          <Hero tone="robot" eyebrow="Robotstøvsuger" title={read.isError ? 'Status ukendt' : 'Ikke forbundet'}
            text={read.isError ? 'Status kunne ikke hentes'
              : 'Forbind robotten i Home Assistant for at se og styre den her.'} />
        )}
      </section>
    );
  }
  return (
    <section id="robot-view" className="flex flex-col gap-8 pb-6" aria-labelledby="robot-title"
      data-robot-state={vacuum?.state ?? row.state}>
      <h1 id="robot-title" className="sr-only">Robotstøvsuger</h1>
      <RobotView key={row.entityId} row={row} vacuum={vacuum} robots={robots} link={link} />
    </section>
  );
}
