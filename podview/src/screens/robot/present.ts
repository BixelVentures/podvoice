// Robot: what each part of the control panel shows, as pure functions of the panel's state (the pre-React panel's
// syncDisabled and updateObservation). Which controls are live, which one shows its command as busy, the hero's
// status, the eyebrow, the progress and the one feedback line under the transport.
import {robotExperience, robotFacts, robotRoom} from '../../../robot-observation.js';
import {deviceLabel, robotDetailMetadata} from '../../../scene-model.js';
import {activeJob, cleaningMode, robotControlGroups, settingConcept} from './model';
import type {RobotOption} from './model';
import type {Layout} from './layout';
import type {PanelState} from './panel-store';
import {expiredOffer, ownRobotPending, settingCurrent} from './value';

export interface Access {
  unavailable: boolean;
  draftHeld: boolean;
  knownPending: boolean;
  pendingId: string | null | undefined;
  pendingOption: RobotOption | undefined;
  pendingChoice: unknown;
  pendingValue: unknown;
}

export function access(state: PanelState): Access {
  const value = state.value ?? {},
    options = value.task?.options ?? [],
    pending = value.device?.pending;
  const actionOptions = pending?.action ? options.filter(option => option.action === pending.action) : [];
  const pendingId =
    value.pendingOptionId || pending?.optionId || (actionOptions.length === 1 ? actionOptions[0]?.id : null);
  const knownPending = !!pending || !!value.pendingOptionId;
  // While the owner fetches a fresh offer (loading), an expired one keeps the controls live; taps wait for it.
  const expired = expiredOffer(value.task) && value.loading !== true;
  const unavailable = state.disabled || value.connected === false || knownPending || !!value.device?.stale || expired;
  // While only a robot command is pending, Start and its local draft stay live: Start shows busy, a changed room or
  // setting is kept for the next Start, and a second Start gets a message (S2).
  const draftHeld =
    knownPending &&
    (!state.disabled || ownRobotPending(value)) &&
    value.readOnly !== true &&
    value.connected !== false &&
    !value.device?.stale &&
    !expired;
  return {
    unavailable,
    draftHeld,
    knownPending,
    pendingId,
    pendingOption: options.find(row => row.id === pendingId),
    pendingChoice: value.pendingChoiceId ?? pending?.choiceId,
    pendingValue: value.pendingValue ?? pending?.value,
  };
}

export interface Control {
  optionId?: string | undefined;
  actionId?: string | undefined;
  direct?: boolean | undefined;
  // In the start form (or Start itself): live while only a robot command runs.
  draft?: boolean | undefined;
  // »Behold turen«: never locked by the robot's state.
  localDraft?: boolean | undefined;
  unready?: boolean | undefined;
  // A radio's own value (its busy mark binds to the exact pending choice or number).
  radio?: string | undefined;
  // A command button that shows its busy mark (button, chip, tile, toggle with an option id).
  command?: boolean | undefined;
}

export interface ControlView {
  disabled: boolean;
  busy: boolean;
}

export function control(state: PanelState, rules: Access, row: Control): ControlView {
  const value = state.value ?? {},
    status = value.device?.status;
  if (row.direct) {
    const action = row.actionId ?? '',
      blocked =
        value.directBlocked === true ||
        value.connected === false ||
        !!value.device?.stale ||
        !value.directActions?.includes(action);
    return {disabled: blocked, busy: !blocked && value.directPendingAction === action};
  }
  const draft = rules.draftHeld && !!row.draft;
  const disabled =
    (!row.localDraft && !draft && rules.unavailable) ||
    !!row.unready ||
    (row.actionId === 'pause' && status !== 'cleaning') ||
    (row.actionId === 'resume' && status !== 'paused');
  const option = rules.pendingOption,
    sameOption = !!option && row.optionId !== undefined && row.optionId === rules.pendingId,
    choice = rules.pendingChoice,
    number = rules.pendingValue;
  const exact =
    row.radio === undefined ||
    (option?.argsSchema.kind === 'choice' &&
      typeof choice === 'string' &&
      (option.argsSchema.choices ?? []).some(item => item.id === choice) &&
      row.radio === choice) ||
    (option?.argsSchema.kind === 'number' && Number.isFinite(number) && row.radio === String(number));
  let busy = rules.knownPending && sameOption && exact && value.connected !== false && !value.device?.stale;
  // The live host marks its pending option's command buttons busy until the panel's next own update.
  if (row.command && state.hostBusy !== undefined) busy = state.hostBusy !== null && row.optionId === state.hostBusy;
  return {disabled, busy};
}

// The note under the panel when nothing (or only status) can be changed here.
export function availabilityText(state: PanelState): string {
  const value = state.value,
    device = value?.device,
    experience = robotExperience(device ?? {}),
    unknownFault = ['fault', 'error'].includes(device?.status ?? '') && !experience.issues.length;
  const hasMap = (state.layout?.sections ?? []).some(
    section =>
      'cleaning' in section
        ? section.cleaning.map?.kind === 'select'
        : 'map' in section && section.map?.kind === 'select',
  );
  if (unknownFault) return 'Åbn Roborock-appen for at se fejlen og få hjælp.';
  if (experience.issues.length) return '';
  if (value?.loading === true) return 'Henter aktuel betjening…';
  if (!value?.task) return value?.readOnly !== false ? 'Kun status er tilgængelig.' : '';
  return hasMap && value.connected !== false ? '' : 'Du kan ikke ændre rengøringen her lige nu.';
}

export interface HeroView {
  resourceStatus: string;
  state: 'pending' | 'ready';
  setupPending: boolean;
  title: string;
  titleHidden: boolean;
  meta: string;
  text: string;
  kitState: 'error' | 'empty' | 'ready';
  kitVariant: 'danger' | 'message' | null;
  eyebrow: string;
  progress: number | null;
  feedback: {text: string; state: string};
}

const percentOf = (state: PanelState): number | null => {
  const value = state.value,
    d = value?.device,
    now = Date.now() / 1000,
    telemetry = d?.telemetry;
  const row =
    d?.status === 'cleaning' &&
    !d.stale &&
    value?.connected !== false &&
    telemetry?.status === 'observed' &&
    Array.isArray(telemetry.items)
      ? telemetry.items.find(item => item.key === 'clean_percent')
      : null;
  const percent = row?.value,
    updatedAt = row?.updatedAt;
  const known =
    row?.stale === false &&
    row.unit === '%' &&
    typeof updatedAt === 'number' &&
    Number.isFinite(updatedAt) &&
    updatedAt >= 0 &&
    updatedAt <= now + 1 &&
    now - updatedAt <= 300 &&
    typeof percent === 'number' &&
    Number.isFinite(percent) &&
    percent >= 0 &&
    percent <= 100;
  return known ? percent : null;
};

// The hero: the robot instrument's own status anatomy (the library's vacuum-widget), the eyebrow over the title
// (lærred »A-Robot«), the cleaning progress and the feedback line.
export function heroView(state: PanelState): HeroView {
  const value = state.value,
    d = value?.device,
    experience = robotExperience(d ?? {}),
    status = d?.status ?? '';
  const statusText = deviceLabel({...d, kind: 'vacuum', live: d?.live !== false}),
    offline = value?.connected === false || !!d?.stale,
    text = offline && !/^Ikke opdateret\b/i.test(statusText) ? `Ikke opdateret · ${statusText}` : statusText,
    detail = (robotDetailMetadata(d) as string | undefined) ?? '',
    resourceStatus = d?.status || 'unknown',
    heroState = d?.pending ? 'pending' : 'ready';
  const failed = ['fault', 'error'].includes(resourceStatus),
    message = ['unavailable', 'disconnected'].includes(resourceStatus),
    statusOnly =
      failed ||
      ['disconnected', 'unavailable', 'unknown'].includes(resourceStatus) ||
      (heroState === 'pending' && !text);
  const statusValue = message
    ? 'Ikke forbundet'
    : text ||
      ({unavailable: 'Ikke forbundet', unknown: 'Status ukendt', fault: 'Status kunne ikke hentes',
        error: 'Status kunne ikke hentes'} as Record<string, string>)[resourceStatus] ||
      'Status ukendt';
  const facts = robotFacts(d ?? {});
  const mode = facts.details.find(row => row.label === 'Rengøringstilstand' && !row.stale)?.value;
  const eyebrow = ['docked', 'charging'].includes(status)
    ? 'Ved basen'
    : ['docking', 'returning'].includes(status)
      ? 'Kør til basen'
      : ['fault', 'error'].includes(status)
        ? 'Robotfejl'
        : ['cleaning', 'paused'].includes(status) && mode
          ? mode
          : 'Robotstøvsuger';
  const pendingStates = ['pending', 'preparing', 'sending'];
  const control = value?.controlFeedback;
  const feedback =
      control?.text && !pendingStates.includes(control.state ?? '')
        ? control
        : state.draftFeedback
          ? {text: state.draftFeedback, state: 'unknown'}
          : null,
    visible =
      typeof feedback?.text === 'string' &&
      feedback.text.length > 0 &&
      feedback.text.length <= 240 &&
      !pendingStates.includes(feedback.state ?? ''),
    feedbackState =
      visible && ['accepted', 'error', 'unknown'].includes(feedback.state ?? '') ? feedback.state : 'ready',
    feedbackText =
      visible && typeof feedback.text === 'string'
        ? feedback.text
        : ['fault', 'error'].includes(status) ||
            (!activeJob(d) && experience.activity !== null && !['Oplader', 'Opladet'].includes(experience.activity))
          ? ''
          : facts.details
              .filter(
                row =>
                  row.group === 'settings' &&
                  !row.stale &&
                  ['Rengøringstilstand', 'Moppeintensitet', 'Moppetilstand'].includes(row.label),
              )
              .map(row => `${row.label}: ${row.value}`)
              .join(' · ');
  return {
    resourceStatus,
    state: heroState,
    setupPending: value?.loading === true && !value.task,
    title: 'Robotstøvsuger',
    titleHidden: message,
    meta: statusOnly
      ? [detail].filter(entry => entry && entry !== text).join(' · ')
      : detail,
    text: statusOnly ? statusValue : text,
    kitState: failed ? 'error' : statusOnly ? 'empty' : 'ready',
    kitVariant: failed ? 'danger' : message ? 'message' : null,
    eyebrow,
    progress: percentOf(state),
    feedback: {text: feedbackText, state: feedbackState ?? 'ready'},
  };
}

export const cleaningReady = (state: PanelState): boolean =>
  !!robotControlGroups(state.value?.task).cleaning && !activeJob(state.value?.device);

// The current room line of »Denne tur« (while cleaning, a fresh current room).
export const currentRoomText = (state: PanelState): string => {
  const room = robotRoom(state.value?.device ?? {});
  return room ? `Rengør nu: ${room}` : 'Valgte rum er ikke oplyst';
};

// The owner-provided selected rooms of the running job, when the setup names them exactly.
export function currentAreas(state: PanelState): {id: string; label: string}[] | null {
  const areas = state.value?.currentSetup?.areas;
  const valid =
    Array.isArray(areas) &&
    areas.length > 0 &&
    areas.length <= 32 &&
    areas.every((area: unknown) => {
      const row = area as {id?: unknown; label?: unknown} | null;
      return (
        !!row &&
        typeof row === 'object' &&
        !Array.isArray(row) &&
        Object.keys(row).sort().join(',') === 'id,label' &&
        typeof row.id === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(row.id) &&
        typeof row.label === 'string' &&
        row.label.trim().length > 0 &&
        row.label.trim().length <= 128
      );
    }) &&
    new Set(areas.map((area: {id: string}) => area.id)).size === areas.length;
  return valid ? (areas as {id: string; label: string}[]) : null;
}

export function currentMapName(state: PanelState): string | null {
  const map = state.value?.currentSetup?.mapName || state.value?.task?.mapName;
  return typeof map === 'string' && map.trim().length > 0 && map.length <= 160 ? map : null;
}

export function repeatStatusText(state: PanelState): string {
  const count = state.value?.currentSetup?.repeat;
  return typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 3
    ? `${String(count)} ${count === 1 ? 'gang' : 'gange'}`
    : 'Aktuelt antal ikke oplyst';
}

// The daily settings the layout shows (outside the start form).
export function robotSettings(layout: Layout | null): RobotOption[] {
  const out: RobotOption[] = [];
  for (const section of layout?.sections ?? []) {
    const controls = 'controls' in section ? section.controls : null;
    for (const row of [...(controls?.mode ?? []), ...(controls?.typed ?? [])]) out.push(row.option);
  }
  return out;
}

// The type the robot reports (its current value), for the levels that do not apply to it.
export function dailyMode(state: PanelState): string | null {
  const mode = robotSettings(state.layout).find(option => settingConcept(option) === 'mode');
  return cleaningMode(
    mode?.argsSchema.choices?.find(choice => choice.id === settingCurrent(state.value, mode))?.label,
  );
}
