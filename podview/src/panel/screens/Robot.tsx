// Robot on HA: the household's vacuums from the PodVoice integration (podvoice.robot_panel_state; lib/ha/robot.ts) and
// its live HA entity. The status line, the facts and the issues are the old Robot screen's own wording
// (scene-model.js, robot-observation.js); the transport is what HA's state and feature bits admit, as the add-on's
// direct transport offered it: Pause/Fortsæt at once, Kør til basen and Afslut rengøring after a confirmation.
// A tap is shown at once, sent once, and the vacuum's next state is its proof; nothing is locked or resent. Rooms,
// settings, recipes and the journal are robot-cleaning.tsx; with more than one vacuum a segmented choice picks one.
import {useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {useNow} from '../../lib/hooks/clock';
import {create, useStore} from 'zustand';
import {robotDetailMetadata, robotExperience, robotFacts, robotLabel} from '../../lib/robot/observation';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {cleaningQuery, robotWishKey, transportActions, useRobotCommands, useRobotState} from '../../lib/ha/robot';
import type {RobotAction, RobotRow} from '../../lib/ha/robot';
import {useEntity, useLink} from '../../lib/ha/transport';
import {Button, Chip, Choices, Icon, ListRow} from '../../ui';
import {useNav} from '../nav';
import {Notice, Shortcut, wishNotice} from '../ui';
import {RobotCleaningSection} from './robot-cleaning';
import {ConfirmOverlay} from './robot-confirm';
import type {ConfirmContent} from './robot-confirm';

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
const LABELS: Record<RobotAction, string> = {
  pause: 'Pause',
  resume: 'Fortsæt',
  stop: 'Afslut rengøring',
  return: 'Kør til basen',
};
const ICONS: Record<RobotAction, string> = {
  pause: 'pause-fill',
  resume: 'play-fill',
  return: 'arrow-u-down-left',
  stop: 'x-lg',
};
const CONFIRM: Partial<Record<RobotAction, ConfirmContent>> = {
  return: {
    title: 'Kør til basen?',
    description: 'Robotten sendes til basen.',
    cancelLabel: 'Behold turen',
    acceptLabel: 'Kør til basen',
    acceptIcon: 'arrow-u-down-left',
  },
  stop: {
    title: 'Afslut rengøringen?',
    description: 'Rengøringen afsluttes. Robotten sendes ikke til basen. Brug Pause, hvis du vil fortsætte senere.',
    cancelLabel: 'Behold turen',
    acceptLabel: 'Afslut rengøring',
    acceptIcon: 'x-lg',
    tone: 'danger',
  },
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

// With more than one vacuum in HA: a segmented choice of the robot shown (nothing extra with one).
function RobotChoice({robots, shown}: {robots: RobotRow[]; shown: string}) {
  if (robots.length < 2) return null;
  return (
    <Choices
      aria-label="Robotstøvsuger"
      value={shown}
      onChange={entityId => {
        useRobotChoice.setState({entityId});
      }}
    >
      {robots.map(robot => (
        <Chip key={robot.entityId} id={robot.entityId}>
          {robot.name}
        </Chip>
      ))}
    </Choices>
  );
}

// The Home tile's line: the robot's status as the old screen words it (with the battery), '' while the first read
// runs, and null when HA has no vacuum or the integration cannot be read: hide the tile then.
export function useRobotLine(): string | null {
  const {link, read, row, vacuum} = useRobot();
  const now = useNow() / 1000;
  if (!row) return read.isPending && link.connected ? '' : null;
  const device = robotDevice(row, vacuum, link.connected);
  const battery = row.telemetry.find(item => item.key === 'battery');
  return [robotLabel(device, now), typeof battery?.value === 'number' ? `${String(Math.round(battery.value))} %` : '']
    .filter(Boolean)
    .join(' · ');
}

export function RobotTile() {
  const line = useRobotLine();
  const push = useNav(state => state.push);
  if (line === null) return null;
  return (
    <Shortcut
      id="home-robot"
      screen="robot"
      iconName="vacuum"
      title="Robotstøvsuger"
      detail={line}
      onPress={() => {
        push('robot');
      }}
    />
  );
}

function Transport({row, vacuum, connected}: {row: RobotRow; vacuum: HassEntityState | null; connected: boolean}) {
  const send = useRobotCommands();
  const wish = useStore(commands.store, state => state.wishes[robotWishKey(row.entityId)]);
  const [asking, setAsking] = useState<RobotAction | null>(null);
  const state = vacuum?.state ?? row.state;
  const features = typeof vacuum?.attributes.supported_features === 'number'
    ? vacuum.attributes.supported_features
    : row.supportedFeatures;
  const offered = transportActions(state, features);
  const primary = state === 'cleaning' ? 'pause' : state === 'paused' ? 'resume' : null;
  const ordered = [...offered].sort((a, b) => Number(b === primary) - Number(a === primary));
  const busy = pending(wish) ? (wish?.value as RobotAction) : null;
  const press = (action: RobotAction) => {
    if (CONFIRM[action]) setAsking(action);
    else send(row, vacuum, action);
  };
  const ask = asking ? CONFIRM[asking] : undefined;
  const content: ConfirmContent | null = asking && ask ? {...ask, acceptDisabled: !connected} : null;
  return (
    <>
      {ordered.length ? (
        <div className="my-pv-s2 flex items-center gap-pv-s2" role="group" aria-label="Betjening">
          {ordered.map(action => (
            <Button
              key={action}
              variant={action === primary ? 'primary' : action === 'stop' ? 'quiet' : 'secondary'}
              className={
                action === primary
                  ? 'bg-pv-robot-ink'
                  : action === 'stop'
                    ? 'px-pv-s2'
                    : 'bg-pv-robot-strong text-pv-robot-ink'
              }
              data-action-id={action}
              busy={busy === action}
              isDisabled={!connected}
              onPress={() => {
                press(action);
              }}
            >
              <Icon name={ICONS[action]} className={action === primary ? 'invert' : ''} />
              {LABELS[action]}
            </Button>
          ))}
        </div>
      ) : null}
      <Notice text={wishNotice(wish)} />
      <ConfirmOverlay
        content={content}
        onCancel={() => {
          setAsking(null);
        }}
        onAccept={() => {
          const action = asking;
          setAsking(null);
          if (action) send(row, vacuum, action);
        }}
      />
    </>
  );
}

interface Issue {
  title: string;
  help: string;
}

// The screen's card and its heading (Robotstøvsuger and the robot's name, or why there is none).
function Frame({line, children}: {line: string; children?: ReactNode}) {
  return (
    <section
      id="robot-view"
      className="flex flex-[1_0_auto] flex-col gap-pv-s2 rounded-pv-l bg-pv-surface p-pv-s3"
      aria-labelledby="robot-title"
    >
      <header className="pb-pv-s1">
        <h1 id="robot-title" className="mt-0 mb-2.5 text-pv-title leading-[1.08] font-medium tracking-[-0.035em]">
          Robotstøvsuger
        </h1>
        <p className="text-pv-meta leading-[19px] text-pv-ink-3">{line}</p>
      </header>
      {children}
    </section>
  );
}

export function RobotScreen() {
  const {link, read, row, vacuum, robots} = useRobot();
  const now = useNow() / 1000;
  if (!row) {
    const loading = read.isPending && link.connected;
    return (
      <Frame
        line={loading ? 'Henter aktuel betjening…' : read.isError ? 'Status kunne ikke hentes' : 'Ikke forbundet'}
      >
        {loading || read.isError ? null : (
          <p className="text-pv-body text-pv-ink-2">Forbind robotten i Home Assistant for at se og styre den her.</p>
        )}
      </Frame>
    );
  }
  const device = robotDevice(row, vacuum, link.connected);
  const issues = (robotExperience(device, now).issues as Issue[]).filter(issue => issue.title);
  const facts = robotFacts(device, now).details.filter(fact => fact.value);
  const meta = robotDetailMetadata(device, now);
  const label = robotLabel(device, now);
  const progress = row.telemetry.find(item => item.key === 'clean_percent');
  const percent =
    device.status === 'cleaning' && !device.stale && progress?.stale !== true && typeof progress?.value === 'number'
      ? progress.value
      : null;
  return (
    <Frame line={row.name}>
      <RobotChoice robots={robots} shown={row.entityId} />
      <article
        className="relative flex min-h-[200px] flex-col items-start justify-center gap-pv-s2 rounded-pv-l bg-pv-robot
          p-pv-s4 text-pv-robot-ink shadow-pv ring-1 ring-pv-robot-strong ring-inset
          group-data-[link=offline]/host:opacity-55"
        data-resource-status={device.status}
        aria-label={`${row.name}: ${label}`}
      >
        <div className="grid size-40 place-items-center" aria-hidden="true">
          <Icon name="vacuum" className="size-[68px] invert" />
        </div>
        <div className="flex w-full flex-col gap-pv-s2 py-pv-s2 text-[16px] leading-5">
          <p role="status">
            {device.stale && !/^Ikke opdateret\b/i.test(label) ? `Ikke opdateret · ${label}` : label}
          </p>
          <p hidden={!meta}>{meta}</p>
          {percent !== null ? (
            <progress className="h-2 w-full accent-pv-robot-ink" max={100} value={percent}
              aria-label="Rengøringens fremdrift" />
          ) : null}
        </div>
        <Transport row={row} vacuum={vacuum} connected={link.connected} />
        <span className="absolute top-pv-s2 right-pv-s3 hidden text-pv-meta text-pv-ink-2
          group-data-[link=offline]/host:block" aria-hidden="true">
          Sidst kendt
        </span>
      </article>
      {issues.length ? (
        <section className="grid gap-pv-s2" aria-label="Robotten">
          {issues.map(issue => (
            <ListRow key={issue.title} tone="feedback" className="flex-wrap gap-x-pv-s1 rounded-pv-s p-pv-s2">
              <strong className="font-semibold">{issue.title}</strong>
              <small className="text-pv-meta text-pv-ink-2">{issue.help}</small>
            </ListRow>
          ))}
        </section>
      ) : null}
      <RobotCleaningSection
        key={row.entityId}
        entityId={row.entityId}
        vacuum={vacuum}
        generation={link.generation}
        connected={link.connected}
      />
      {facts.length ? (
        <dl className="grid gap-pv-s2">
          {facts.map(fact => (
            <ListRow key={fact.label} className="rounded-pv-s p-pv-s2">
              <dt className="text-pv-ink-2">{fact.label}</dt>
              <dd className="ml-auto text-right">{fact.stale ? `${fact.value} · ikke opdateret` : fact.value}</dd>
            </ListRow>
          ))}
        </dl>
      ) : null}
    </Frame>
  );
}
