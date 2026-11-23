// Robot on HA: the household's vacuum from the PodVoice integration (podvoice.robot_panel_state; lib/ha/robot.ts) and
// its live HA entity. The status line, the facts and the issues are the old Robot screen's own wording
// (scene-model.js, robot-observation.js); the transport is what HA's state and feature bits admit, as the add-on's
// direct transport offered it: Pause/Fortsæt at once, Kør til basen and Afslut rengøring after a confirmation.
// A tap is shown at once, sent once, and the vacuum's next state is its proof; nothing is locked or resent.
import {useEffect, useState} from 'react';
import {useStore} from 'zustand';
import {robotExperience, robotFacts} from '../../../robot-observation.js';
import {deviceLabel, robotDetailMetadata} from '../../../scene-model.js';
import {commands} from '../../lib/ha/commands';
import type {Wish} from '../../lib/ha/commands';
import type {HassEntityState} from '../../lib/ha/hass';
import {robotWishKey, transportActions, useRobotCommands, useRobotState} from '../../lib/ha/robot';
import type {RobotAction, RobotRow} from '../../lib/ha/robot';
import {useEntity, useLink} from '../../lib/ha/transport';
import {KitButton} from '../../lib/ui/KitButton';
import {useNav} from '../nav';
import {BUTTON, icon, Notice, Shortcut, wishNotice} from '../ui';
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
const CONFIRM: Partial<Record<RobotAction, Omit<ConfirmContent, 'id'>>> = {
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

// The robot shown: the first vacuum HA has (the integration sorts by entity id).
function useRobot() {
  const link = useLink();
  const read = useRobotState(link.generation);
  const row = read.data?.robots[0] ?? null;
  const vacuum = useEntity(row?.entityId ?? null);
  const live = vacuum?.state;
  const {refetch} = read;
  // A new vacuum state brings new sensor values (room, area, progress): read them now, not at the next interval.
  useEffect(() => {
    if (live && row && live !== row.state) void refetch();
  }, [live, row, refetch]);
  return {link, read, row, vacuum};
}

// The Home tile's line: the robot's status as the old screen words it (with the battery), '' while the first read
// runs, and null when HA has no vacuum or the integration cannot be read: hide the tile then.
export function useRobotLine(): string | null {
  const {link, read, row, vacuum} = useRobot();
  if (!row) return read.isPending && link.connected ? '' : null;
  const device = robotDevice(row, vacuum, link.connected);
  const battery = row.telemetry.find(item => item.key === 'battery');
  return [deviceLabel(device), typeof battery?.value === 'number' ? `${String(Math.round(battery.value))} %` : '']
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
  const content: ConfirmContent | null =
    asking && ask ? {id: `robot-confirm-${asking}`, ...ask, acceptDisabled: !connected} : null;
  return (
    <>
      {ordered.length ? (
        <div className="pv-actions transport" role="group" aria-label="Betjening">
          {ordered.map(action => (
            <KitButton
              key={action}
              className={`${BUTTON}${action === 'stop' ? ' stop' : ''}`}
              data-kit="button"
              data-kit-shape="pill"
              data-kit-variant={action === primary ? 'primary' : action === 'stop' ? 'quiet' : undefined}
              data-action-id={action}
              aria-busy={busy === action ? true : undefined}
              isDisabled={!connected}
              onPress={() => {
                press(action);
              }}
            >
              <img className="pv-kit pv-kit-icon pv-icon" data-kit="icon" src={icon(ICONS[action])} alt="" />
              <span>{LABELS[action]}</span>
            </KitButton>
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

export function RobotScreen() {
  const {link, read, row, vacuum} = useRobot();
  if (!row) {
    const loading = read.isPending && link.connected;
    return (
      <section id="robot-view" className="response-widget" aria-labelledby="robot-title">
        <header className="response-heading">
          <div>
            <h1 id="robot-title">Robotstøvsuger</h1>
            <p>
              {loading ? 'Henter aktuel betjening…' : read.isError ? 'Status kunne ikke hentes' : 'Ikke forbundet'}
            </p>
          </div>
        </header>
        {loading || read.isError ? null : (
          <p className="screen-explanation">Forbind robotten i Home Assistant for at se og styre den her.</p>
        )}
      </section>
    );
  }
  const device = robotDevice(row, vacuum, link.connected);
  const issues = (robotExperience(device).issues as Issue[]).filter(issue => issue.title);
  const facts = robotFacts(device).details.filter(fact => fact.value);
  const meta = robotDetailMetadata(device);
  const label = deviceLabel(device);
  const progress = row.telemetry.find(item => item.key === 'clean_percent');
  const percent =
    device.status === 'cleaning' && !device.stale && progress?.stale !== true && typeof progress?.value === 'number'
      ? progress.value
      : null;
  return (
    <section id="robot-view" className="response-widget" aria-labelledby="robot-title">
      <header className="response-heading">
        <div>
          <h1 id="robot-title">Robotstøvsuger</h1>
          <p>{row.name}</p>
        </div>
      </header>
      <article
        className="pv-kit pv-kit-hero pv-hero robot-hero"
        data-kit="hero"
        data-kit-identity="robot"
        data-resource-status={device.status}
        aria-label={`${row.name}: ${label}`}
      >
        <div className="pv-instrument" data-kit-slot="icon" aria-hidden="true">
          <img src={icon('vacuum')} alt="" />
        </div>
        <div data-kit-slot="copy">
          <p className="pv-resource-value" data-kit-slot="title" role="status">
            {device.stale && !/^Ikke opdateret\b/i.test(label) ? `Ikke opdateret · ${label}` : label}
          </p>
          <p className="pv-meta" data-kit-slot="body" hidden={!meta}>
            {meta}
          </p>
          {percent !== null ? <progress max={100} value={percent} aria-label="Rengøringens fremdrift" /> : null}
        </div>
        <Transport row={row} vacuum={vacuum} connected={link.connected} />
      </article>
      {issues.length ? (
        <section className="robot-issues" aria-label="Robotten">
          {issues.map(issue => (
            <p
              key={issue.title}
              className="pv-kit pv-kit-listrow pv-row"
              data-kit="listrow"
              data-kit-variant="feedback"
            >
              <strong>{issue.title}</strong> <small>{issue.help}</small>
            </p>
          ))}
        </section>
      ) : null}
      {facts.length ? (
        <dl className="robot-facts">
          {facts.map(fact => (
            <div key={fact.label} className="pv-kit pv-kit-listrow pv-row" data-kit="listrow">
              <dt>{fact.label}</dt>
              <dd>{fact.stale ? `${fact.value} · ikke opdateret` : fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
