// Robot: which parts the control panel shows for an offer (the pre-React robot-control-panel.js build()), as plain
// data. A layout is made once per offer; while the same offer stays current the panel keeps it, so every element keeps
// its identity. Presentation follows admitted options only: the start form, the daily settings, the transport row,
// the base disclosure »Mere« and the active job's own card.
import {
  activeJob,
  choiceLabel,
  LEVEL_ICONS,
  robotControlGroups,
  roomIcon,
  settingConcept,
  settingLabel,
  settingOrder,
  visibleSettingChoices,
} from './model';
import type {RobotArea, RobotChoice, RobotOption, RobotStartSetting, RobotTask} from './model';
import type {PanelValue} from './value';

let serial = 0;
const next = () => String(++serial);

export interface RailDef {
  id: string;
  // The radios' shared name (the cleaning form's repeat is »repeat«, every other rail its id).
  name: string;
  label: string;
  icon: string | null;
  choices: {value: string; label: string}[];
  // Classes added to pv-kit-choice-group, in the order the old builder added them.
  classes: string[];
  attrs: Record<string, string>;
  inputAttrs: Record<string, string>;
  // Read-only rails (the active job's observed repeat): every radio is unready and disabled.
  readOnly?: true;
}

export interface StartSettingDef {
  setting: RobotStartSetting;
  concept: string;
  descriptor: {settingKey: string | undefined; label: string};
  rail: RailDef;
}

export interface CleaningDef {
  option: RobotOption;
  formId: string;
  areas: RobotArea[];
  repeat: {min: number; max: number};
  repeatRail: RailDef;
  settings: StartSettingDef[];
  recipe: string | null;
  map: MapDef | null;
  // A valid history draft fills the form once (validHistoryDraft).
  historyDraft: {areaIds: string[]; repeat: unknown} | null;
}

export type MapDef =
  | {kind: 'meta'; name: string; current: boolean}
  | {kind: 'select'; option: RobotOption; name: string; choices: RobotChoice[]};

export type SettingDef =
  | {kind: 'readonly'; option: RobotOption; concept: string; icon: string | null}
  | {kind: 'level'; option: RobotOption; concept: string; rail: RailDef}
  | {kind: 'repeat-number'; option: RobotOption; rail: RailDef}
  | {kind: 'field'; option: RobotOption};

// A group of the controls card: Type first, then one group with the settings for the chosen type.
export interface ControlsDef {
  mode: SettingDef[];
  typed: SettingDef[];
  // The active job's repeat: a settings rail, an observed read-only rail, or the status row.
  repeat: {kind: 'rail'; rail: RailDef} | {kind: 'row'} | null;
  note: string | null;
}

export type SectionDef =
  | {kind: 'cleaning'; cleaning: CleaningDef; controls: ControlsDef | null}
  | {kind: 'empty-rooms'; map: MapDef | null}
  | {kind: 'settings-zone'; controls: ControlsDef}
  | {kind: 'current-rooms'; map: MapDef | null}
  | {kind: 'current-settings'; controls: ControlsDef}
  | {kind: 'reuse'; key: string}
  | {kind: 'availability'};

export interface ActionDef {
  key: string;
  option: RobotOption;
  label: string;
  // The classes the old make() gave it (pv-primary is the transport row's to decide).
  className: string;
  attrs: Record<string, string>;
  icon: {tag: 'img' | 'span'; src: string; variant?: string};
}

export type TransportItem = {kind: 'action'; key: string} | {kind: 'submit'} | {kind: 'base'};

export interface Layout {
  build: string;
  // An open direct confirmation kept through a same-scope rebuild is drawn before the hero, as before.
  dialogFirst: boolean;
  actions: Record<string, ActionDef>;
  transport: TransportItem[];
  base: {id: string; items: string[]} | null;
  sections: SectionDef[];
  directSignature: string | null;
}

const TRANSPORT_ICONS: Record<string, string> = {
  pause: 'pause-fill',
  resume: 'play-fill',
  return: 'arrow-u-down-left',
  stop: 'x-lg',
};
const DIRECT_LABELS: Record<string, string> = {
  pause: 'Pause',
  resume: 'Fortsæt',
  stop: 'Afslut rengøring',
  return: 'Kør til basen',
};

function repeatRail(id: string, min: number, max: number, extra: Partial<RailDef> = {}): RailDef {
  return {
    id,
    name: id,
    label: 'Antal gange',
    icon: `assets/icons/${LEVEL_ICONS.repeat ?? ''}.svg`,
    choices: Array.from({length: max - min + 1}, (_, i) => ({value: String(min + i), label: `${String(min + i)}×`})),
    classes: ['robot-repeat-choice'],
    attrs: {'data-kit-size': 'compact'},
    inputAttrs: {},
    ...extra,
  };
}

const levelIcon = (concept: string): string | null => {
  const asset = LEVEL_ICONS[concept];
  return asset ? `assets/icons/${asset}.svg` : null;
};

// The transport options in the hero (renderTransportOptions): the current run's primary first.
function transportActions(layout: Layout, options: RobotOption[], status: string | undefined): void {
  if (!options.length) return;
  const wanted = status === 'cleaning' ? 'pause' : status === 'paused' ? 'resume' : null;
  const primary = options.find(option => option.action === wanted);
  const items: TransportItem[] = [];
  for (const option of [...options].sort((a, b) => Number(b === primary) - Number(a === primary))) {
    const stop = option.action === 'stop',
      key = `t${next()}`;
    const src = `assets/icons/${TRANSPORT_ICONS[option.action] ?? ''}.svg`;
    layout.actions[key] = {
      key,
      option,
      label: stop ? 'Afslut rengøring' : option.label,
      className: stop ? 'pv-button pv-ghost stop' : option === primary ? 'pv-button pv-primary' : 'pv-button',
      attrs: {
        type: 'button',
        'data-kit-shape': 'pill',
        'data-action-id': option.action,
        'data-control-option-id': option.id,
        ...(option.direct ? {'data-direct-robot': 'true'} : {}),
      },
      icon: stop ? {tag: 'span', src} : {tag: 'img', src, variant: 'default'},
    };
    items.push({kind: 'action', key});
  }
  // A re-rendered offer takes the same place as before: in front of Base, never after it (S3).
  layout.transport = layout.transport.some(item => item.kind === 'base')
    ? [...items, ...layout.transport]
    : [...layout.transport, ...items];
}

function baseOf(layout: Layout): {id: string; items: string[]} {
  if (!layout.base) {
    layout.base = {id: `robot-base-${next()}`, items: []};
    layout.transport = [...layout.transport, {kind: 'base'}];
  }
  return layout.base;
}

// During a run, »Kør til basen« moves from the row into »Mere« (lærred »A-Robot«).
function compactActiveActions(layout: Layout, status: string | undefined): void {
  if (!['cleaning', 'paused'].includes(status ?? '')) return;
  const home = layout.transport.find(
    item => item.kind === 'action' && layout.actions[item.key]?.option.action === 'return',
  );
  if (home?.kind !== 'action') return;
  layout.transport = layout.transport.filter(item => item !== home);
  const base = baseOf(layout);
  base.items = [home.key, ...base.items];
}

// The owner's direct Pause/Fortsæt/Afslut/Kør til basen, rebuilt only when the offered actions or status change.
export function syncDirectTransport(layout: Layout, value: PanelValue): Layout {
  if (!Array.isArray(value.directActions)) return layout;
  const signature = JSON.stringify([value.directActions, value.device?.status]);
  if (signature === layout.directSignature) return layout;
  const out: Layout = {
    ...layout,
    actions: {...layout.actions},
    transport: [...layout.transport],
    base: layout.base ? {...layout.base, items: [...layout.base.items]} : null,
    directSignature: signature,
  };
  const direct = (key: string) => out.actions[key]?.option.direct === true;
  out.transport = out.transport.filter(item => item.kind !== 'action' || !direct(item.key));
  if (out.base) out.base.items = out.base.items.filter(key => !direct(key));
  transportActions(
    out,
    value.directActions.map(action => ({
      id: 'direct:' + action,
      action,
      label: DIRECT_LABELS[action] ?? '',
      direct: true,
      argsSchema: {kind: 'none'},
    })),
    value.device?.status,
  );
  compactActiveActions(out, value.device?.status);
  return out;
}

function mapDef(value: PanelValue, mapName: unknown): MapDef | null {
  const name = typeof mapName === 'string' ? mapName : '';
  const option = robotControlGroups(value.task).settings.find(
    row =>
      row.argsSchema.kind === 'choice' &&
      (row.argsSchema.choices ?? []).length > 0 &&
      (['map', 'map_id', 'active_map', 'selected_map'].includes(row.settingKey ?? '') ||
        /^(Kort|Etage)$/.test(row.label)),
  );
  if (!option) {
    if (mapName || activeJob(value.device)) return {kind: 'meta', name, current: activeJob(value.device)};
    return null;
  }
  return {kind: 'select', option, name, choices: option.argsSchema.choices ?? []};
}

// The admitted daily settings (every offered choice here is a frequent level, sent at once): a level rail, a bounded
// repeat, a typed number, or a read-only row.
function settingDef(option: RobotOption, readOnly: boolean): SettingDef {
  const concept = settingConcept(option),
    schema = option.argsSchema;
  if (readOnly) return {kind: 'readonly', option, concept, icon: levelIcon(concept)};
  const {min, max} = schema;
  if (
    schema.kind === 'number' &&
    concept === 'repeat' &&
    typeof min === 'number' &&
    typeof max === 'number' &&
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= 1 &&
    max <= 3 &&
    schema.step === 1
  ) {
    const rail = repeatRail(`robot-repeat-${next()}`, min, max, {
      attrs: {'data-kit-size': 'compact', 'data-setting-concept': 'repeat'},
      classes: ['robot-repeat-choice', 'robot-level-setting'],
      inputAttrs: {'data-control-option-id': option.id},
    });
    return {kind: 'repeat-number', option, rail};
  }
  if (schema.kind === 'choice') {
    const id = `robot-setting-${next()}`;
    const rail: RailDef = {
      id,
      name: id,
      label: settingLabel(option),
      icon: levelIcon(concept),
      choices: visibleSettingChoices(option, schema.choices ?? []).map(choice => ({
        value: choice.id,
        label: choiceLabel(option, choice),
      })),
      classes: concept === 'repeat' ? ['robot-repeat-choice', 'robot-level-setting'] : ['robot-level-setting'],
      attrs: {
        'data-setting-concept': concept,
        ...(concept === 'repeat' || concept === 'mop_mode' ? {'data-kit-size': 'compact'} : {}),
      },
      inputAttrs: {'data-robot-choice-kind': 'choiceId', 'data-control-option-id': option.id},
    };
    return {kind: 'level', option, concept, rail};
  }
  return {kind: 'field', option};
}

function cleaningDef(value: PanelValue, option: RobotOption, historyDraft: CleaningDef['historyDraft']): CleaningDef {
  const schema = option.argsSchema,
    range = schema.repeat ?? {min: 1, max: 1},
    formId = `robot-cleaning-${next()}`;
  const settings = [...(schema.settings ?? [])]
    .sort(
      (a, b) => settingOrder({settingKey: a.key, label: a.label}) - settingOrder({settingKey: b.key, label: b.label}),
    )
    .map((setting): StartSettingDef => {
      const descriptor = {settingKey: setting.key, label: setting.label},
        concept = settingConcept(descriptor);
      return {
        setting,
        concept,
        descriptor,
        rail: {
          id: `${formId}-${setting.id}`,
          name: `${formId}-${setting.id}`,
          label: settingLabel(descriptor),
          icon: levelIcon(concept),
          choices: visibleSettingChoices(descriptor, setting.choices).map(choice => ({
            value: choice.id,
            label: choiceLabel(descriptor, choice),
          })),
          classes: ['setting', 'robot-staged-setting', 'robot-level-setting'],
          attrs: {'data-setting-concept': concept, ...(concept === 'mop_mode' ? {'data-kit-size': 'compact'} : {})},
          inputAttrs: {'data-robot-choice-kind': 'settingChoice', 'data-setting-id': setting.id},
        },
      };
    });
  const rows = value.task?.recipeSummary;
  return {
    option,
    formId,
    areas: schema.areas ?? [],
    repeat: range,
    repeatRail: repeatRail(`${formId}-repeat`, range.min, range.max, {
      name: 'repeat',
      classes: ['robot-repeat-choice', 'repeat', 'robot-level-setting'],
      attrs: {'data-kit-size': 'compact', 'data-setting-concept': 'repeat'},
    }),
    settings,
    recipe:
      Array.isArray(rows) && rows.length && !schema.settings?.length
        ? rows.map(row => `${row.label}: ${row.value}`).join(' · ')
        : null,
    map: mapDef(value, value.task?.mapName),
    historyDraft,
  };
}

function dockActions(layout: Layout, options: RobotOption[]): void {
  const stops = options.filter(option => option.argsSchema.operation?.endsWith('_stop')),
    starts = options.filter(option => !option.argsSchema.operation?.endsWith('_stop'));
  const labels: Record<string, string> = {wash_start: 'Vask', empty_start: 'Tøm støv', dry_start: 'Tør'};
  const full: Record<string, string> = {
    wash_start: 'Vask moppe',
    empty_start: 'Tøm støvbeholder',
    dry_start: 'Tør moppe',
  };
  const make = (option: RobotOption, attention: boolean): string => {
    const operation = option.argsSchema.operation ?? '',
      key = `d${next()}`;
    const icon = operation.endsWith('_stop')
      ? 'stop'
      : operation.startsWith('wash')
        ? 'drop'
        : operation.startsWith('empty')
          ? 'vacuum'
          : 'wind';
    const fullLabel = full[operation];
    layout.actions[key] = {
      key,
      option,
      label: labels[operation] || option.label,
      className: 'pv-button',
      attrs: {
        type: 'button',
        'data-kit-shape': 'pill',
        'data-control-option-id': option.id,
        'data-dock-operation': operation,
        ...(fullLabel ? {'aria-label': fullLabel} : {}),
        ...(attention ? {'data-base-attention': 'true'} : {}),
      },
      icon: {tag: 'img', src: `assets/icons/${icon}.svg`},
    };
    return key;
  };
  // Lærred »A-Robot«: the hero holds the primary action and »Mere ▾« only. A running base operation's stop comes
  // first in Mere (amber, »Basen · …«), so it never shows as a second dark button beside Start.
  if (!stops.length && !starts.length) return;
  const base = baseOf(layout);
  if (stops.length) base.items = [...stops.map(option => make(option, true)), ...base.items];
  if (starts.length) base.items = [...base.items, ...starts.map(option => make(option, false))];
}

// validHistoryDraft: an accepted start from the history fills the form only when it fits the current offer exactly.
export type HistoryCheck = (task: RobotTask, draft: unknown) => CleaningDef['historyDraft'];

export function buildLayout(value: PanelValue, history: HistoryCheck, dialogFirst: boolean): Layout {
  const {task, device} = value,
    groups = robotControlGroups(task),
    active = activeJob(device);
  const layout: Layout = {
    build: next(),
    dialogFirst,
    actions: {},
    transport: [],
    base: null,
    sections: [],
    directSignature: null,
  };
  let out = layout;
  if (Array.isArray(value.directActions)) out = syncDirectTransport(layout, value);
  else transportActions(layout, groups.transport, device?.status);
  const historyDraft = task ? history(task, task.historyDraft) : null;
  let cleaning: CleaningDef | null = null;
  if (groups.cleaning && !active) {
    cleaning = cleaningDef(value, groups.cleaning, historyDraft);
    out.sections.push({kind: 'cleaning', cleaning, controls: null});
    out.transport = [{kind: 'submit'}, ...out.transport];
  } else if (task && !active && (task.mapName || groups.settings.length))
    out.sections.push({kind: 'empty-rooms', map: mapDef(value, task.mapName)});
  const daily = groups.settings.filter(
    option =>
      ((option.argsSchema.kind === 'choice' &&
        ['mode', 'suction', 'water', 'mop_mode', 'repeat'].includes(settingConcept(option))) ||
        (option.argsSchema.kind === 'number' && settingConcept(option) === 'repeat')) &&
      (!groups.cleaning?.argsSchema.settings?.length || active),
  );
  const sorted = [...daily].sort((a, b) => settingOrder(a) - settingOrder(b));
  const isMode = (option: RobotOption) => settingConcept(option) === 'mode';
  if (daily.length && !groups.cleaning && !active) {
    const controls: ControlsDef = {
      mode: sorted.filter(isMode).map(option => settingDef(option, false)),
      typed: sorted.filter(option => !isMode(option)).map(option => settingDef(option, false)),
      repeat: null,
      note: null,
    };
    out.sections.push({kind: 'settings-zone', controls});
  } else if (daily.length || active) {
    if (active) {
      out.sections.push({kind: 'current-rooms', map: mapDef(value, value.currentSetup?.mapName || task?.mapName)});
      // During a job the type is shown read-only; the levels for that type stay live.
      const controls: ControlsDef = {
        mode: sorted.filter(isMode).map(option => settingDef(option, true)),
        typed: sorted.filter(option => !isMode(option)).map(option => settingDef(option, false)),
        repeat: null,
        note: null,
      };
      if (!daily.some(option => settingConcept(option) === 'repeat')) controls.repeat = activeRepeat(value);
      out.sections.push({kind: 'current-settings', controls});
    } else if (cleaning) {
      // Without a job these rows are read-only and join the start form's options.
      const section = out.sections.find(row => row.kind === 'cleaning');
      if (section?.kind === 'cleaning')
        section.controls = {
          mode: sorted.filter(isMode).map(option => settingDef(option, true)),
          typed: sorted.filter(option => !isMode(option)).map(option => settingDef(option, true)),
          repeat: null,
          note: daily.length ? 'De viste robotindstillinger kan ikke ændres i dette rengøringssetup.' : null,
        };
    }
  }
  if (groups.reuse && !historyDraft && !groups.cleaning && !active) {
    const key = `r${next()}`;
    out.actions[key] = {
      key,
      option: groups.reuse,
      label: 'Start denne rengøring',
      className: 'pv-button pv-primary start',
      attrs: {'data-control-option-id': groups.reuse.id, type: 'button'},
      icon: {tag: 'img', src: 'assets/icons/play-fill.svg'},
    };
    out.sections.push({kind: 'reuse', key});
  }
  if (
    !task ||
    (!groups.cleaning && !groups.reuse && !daily.length && !groups.transport.length && !groups.dock.length)
  )
    out.sections.push({kind: 'availability'});
  dockActions(out, groups.dock);
  compactActiveActions(out, device?.status);
  return out;
}

// The active job's repeat: a read-only rail for an explicit local example with a known range, else a status row.
function activeRepeat(value: PanelValue): ControlsDef['repeat'] {
  const range = value.currentSetup?.repeatRange,
    count = value.currentSetup?.repeat,
    min = range?.min,
    max = range?.max;
  const known =
    value.localOnly === true &&
    value.device?.exampleOnly === true &&
    typeof min === 'number' &&
    typeof max === 'number' &&
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= 1 &&
    max <= 3 &&
    min <= max &&
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= min &&
    count <= max;
  if (!known) return {kind: 'row'};
  return {
    kind: 'rail',
    rail: repeatRail(`robot-repeat-observed-${next()}`, min, max, {
      classes: ['robot-repeat-choice', 'robot-repeat-status', 'robot-level-setting'],
      readOnly: true,
    }),
  };
}

export {roomIcon};
