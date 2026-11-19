// Robot: the pure rules of the robot control panel, unchanged from the pre-React robot-control-panel.js. Which
// options are shown where (robotControlGroups), how a source setting is named and labelled, which choices a known
// cleaning mode presents, and when a renewed offer may keep its controls (rebindMap). No DOM, no commands.
import {robotExperience} from '../../../robot-observation.js';

export interface RobotChoice {
  id: string;
  label: string;
}

export interface RobotArea {
  id: string;
  label: string;
}

export interface RobotStartSetting {
  id: string;
  key?: string | undefined;
  label: string;
  choices: RobotChoice[];
  current?: string | null | undefined;
}

export interface RobotArgsSchema {
  kind: string;
  areas?: RobotArea[];
  repeat?: {min: number; max: number};
  settings?: RobotStartSetting[] | undefined;
  choices?: RobotChoice[];
  current?: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  operation?: string;
}

export interface RobotOption {
  id: string;
  action: string;
  label: string;
  settingKey?: string | undefined;
  argsSchema: RobotArgsSchema;
  direct?: boolean;
}

export interface RobotTaskDraft {
  status?: string;
  optionId?: string;
  areaIds?: string[];
  repeat?: number | null;
  settingChoices?: {settingId: string | undefined; choiceId: string | undefined}[];
}

export interface RobotTask {
  domain?: string;
  taskId?: string;
  bootId?: string;
  roomId?: string;
  revision?: number;
  expiresAt?: number;
  mapName?: string;
  options: RobotOption[];
  historyDraft?: unknown;
  draft?: RobotTaskDraft | undefined;
  rebind?: {status?: string; sourceTaskId?: string; ids?: {oldId: string; newId: string}[]};
  recipeSummary?: {label: string; value: string}[];
}

export interface RobotPending {
  action?: string;
  optionId?: string;
  choiceId?: string;
  value?: number;
}

export interface RobotTelemetryRow {
  key: string;
  value: unknown;
  unit?: string | null;
  stale?: boolean;
  updatedAt?: number;
}

export interface RobotDevice {
  id?: string;
  status?: string;
  stale?: boolean;
  live?: boolean;
  pending?: RobotPending | null;
  localJob?: {active?: boolean} | null;
  exampleOnly?: boolean;
  telemetry?: {status?: string; items?: RobotTelemetryRow[]};
}

export function activeJob(device: RobotDevice | null | undefined): boolean {
  return (
    ['cleaning', 'paused'].includes(device?.status ?? '') ||
    robotExperience(device).jobActive === true ||
    (device?.live !== true && device?.localJob?.active === true)
  );
}

const FREQUENT_KEYS = [
  'suction',
  'fan_speed',
  'water',
  'water_volume',
  'mop_intensity',
  'cleaning_mode',
  'mop_mode',
  'repeat',
  'cleaning_repeat',
  'clean_count',
];

export interface SettingLike {
  settingKey?: string | undefined;
  label?: string | undefined;
}

export const frequentSetting = (option: SettingLike): boolean =>
  option.settingKey
    ? FREQUENT_KEYS.includes(option.settingKey)
    : /sug|vand|moppeintensitet|rengøringstilstand|rengøringstype|moppetilstand|antal gange|gennemløb/i.test(
        option.label ?? '',
      );

export type SettingConcept = 'repeat' | 'suction' | 'water' | 'mode' | 'mop_mode';

export function settingConcept(option: SettingLike): string {
  const key = option.settingKey,
    label = option.label ?? '';
  if (
    ['repeat', 'cleaning_repeat', 'clean_count'].includes(key ?? '') ||
    (!key && /^(?:Antal gange|Gennemløb)$/i.test(label))
  )
    return 'repeat';
  if (['suction', 'fan_speed'].includes(key ?? '') || (!key && /sug/i.test(label))) return 'suction';
  if (['water', 'water_volume', 'mop_intensity'].includes(key ?? '') || (!key && /vand|moppeintensitet/i.test(label)))
    return 'water';
  if (key === 'cleaning_mode' || (!key && /rengøringstilstand|rengøringstype/i.test(label))) return 'mode';
  if (key === 'mop_mode' || (!key && /moppetilstand/i.test(label))) return 'mop_mode';
  // An unknown concept is the source label itself (undefined without one, as before).
  return option.label as unknown as string;
}

const ORDER: Record<string, number> = {mode: 0, suction: 1, water: 2, mop_mode: 3, repeat: 4};
export const settingOrder = (option: SettingLike): number => ORDER[settingConcept(option)] ?? 4;

const LABELS: Record<string, string> = {
  mode: 'Type',
  suction: 'Sugeevne',
  water: 'Vandmængde',
  repeat: 'Antal gange',
  mop_mode: 'Rute',
};
export const settingLabel = (option: SettingLike): string =>
  LABELS[settingConcept(option)] ?? (option.label as unknown as string);

const CHOICE_LABELS: Record<string, Record<string, string>> = {
  mode: {
    vacuum: 'Støvsug',
    støvsugning: 'Støvsug',
    gulvvask: 'Vask',
    vacuum_and_mop: 'Støvsug og vask',
    vac_and_mop: 'Støvsug og vask',
    mop: 'Vask',
    custom: 'Tilpasset',
  },
  suction: {
    quiet: 'Stille',
    balanced: 'Balanceret',
    turbo: 'Turbo',
    extreme: 'Extreme',
    max: 'Maks.',
    maksimal: 'Maks.',
    'maksimal+': 'Maks.+',
    max_plus: 'Maks.+',
    off: 'Fra',
    custom: 'Tilpasset',
  },
  water: {
    off: 'Fra',
    low: 'Lav',
    medium: 'Mellem',
    high: 'Høj',
    extreme: 'Extreme',
    mild: 'Let',
    moderate: 'Normal',
    intense: 'Grundig',
    custom: 'Tilpasset',
    custom_water_flow: 'Tilpasset vandmængde',
  },
  mop_mode: {
    standard: 'Standard',
    fast: 'Hurtig',
    custom: 'Tilpasset',
    deep: 'Grundig',
    deep_plus: 'Grundig+',
    'ekstra grundig': 'Grundig+',
  },
};

export function choiceLabel(option: SettingLike, choice: RobotChoice): string {
  const raw = choice.label.toLocaleLowerCase('da-DK'),
    concept = settingConcept(option),
    count = concept === 'repeat' && /^([1-3])(?:\s*(?:×|gange?))?$/.exec(raw);
  if (count) return `${count[1] ?? ''}×`;
  const labels = CHOICE_LABELS[concept] ?? {};
  return labels[raw] || choice.label;
}

const MODES: Record<string, string> = {
  vacuum: 'vacuum',
  støvsug: 'vacuum',
  støvsugning: 'vacuum',
  mop: 'mop',
  vask: 'mop',
  gulvvask: 'mop',
  begge: 'both',
  vac_and_mop: 'both',
  vacuum_and_mop: 'both',
  'støvsug og vask': 'both',
  'støvsugning og gulvvask': 'both',
};
export const cleaningMode = (label: string | undefined): string | null =>
  MODES[label?.trim().toLocaleLowerCase('da-DK') ?? ''] ?? null;

export const irrelevantSetting = (concept: string, mode: string | null): boolean =>
  (mode === 'mop' && concept === 'suction') || (mode === 'vacuum' && concept === 'water');

const SPECIAL_LEVELS = [
  'off',
  'fra',
  'custom',
  'tilpasset',
  'custom_water_flow',
  'custom water flow',
  'vandflow (tilpasset)',
  'tilpasset vandmængde',
];
export function specialChoice(option: SettingLike, choice: RobotChoice | undefined): boolean {
  const concept = settingConcept(option),
    label = choice ? choiceLabel(option, choice).trim().toLocaleLowerCase('da-DK') : '';
  return (
    (['suction', 'water'].includes(concept) && SPECIAL_LEVELS.includes(label)) ||
    (concept === 'mode' && ['custom', 'tilpasset'].includes(label))
  );
}

export function visibleSettingChoices(option: SettingLike, choices: RobotChoice[]): RobotChoice[] {
  const visible = choices.filter(choice => !specialChoice(option, choice));
  if (settingConcept(option) !== 'mode') return visible;
  const rank: Record<string, number> = {both: 0, vacuum: 1, mop: 2};
  const order = (choice: RobotChoice) => rank[cleaningMode(choice.label) ?? ''] ?? 3;
  return visible
    .map((choice, index) => ({choice, index}))
    .sort((a, b) => order(a.choice) - order(b.choice) || a.index - b.index)
    .map(row => row.choice);
}

export const specialSelection = (option: SettingLike, choices: RobotChoice[], current: unknown) =>
  choices.find(choice => choice.id === current && specialChoice(option, choice));

export function compactSetting(concept: string, label: string, value: string): string {
  if (concept === 'mode') return value;
  if (concept === 'suction') return /sug/i.test(value) ? value : `${value} sug`;
  if (concept === 'water') return /vand/i.test(value) ? value : `${value} vand`;
  return `${label}: ${value}`;
}

const omit = (value: object, keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

export function sameTaskContent(a: RobotTask | null | undefined, b: RobotTask | null | undefined): boolean {
  if (!a || !b) return false;
  return JSON.stringify(omit(a, ['expiresAt'])) === JSON.stringify(omit(b, ['expiresAt']));
}

// A renewal may preserve DOM identity only when the server attests a complete
// bijection and the client independently verifies that the offer is unchanged.
function taskIds(task: RobotTask): string[] {
  const out: string[] = [];
  for (const option of task.options) {
    out.push(option.id);
    const s = option.argsSchema;
    for (const area of s.areas ?? []) out.push(area.id);
    for (const setting of s.settings ?? []) {
      out.push(setting.id);
      for (const choice of setting.choices) out.push(choice.id);
    }
    for (const choice of s.choices ?? []) out.push(choice.id);
  }
  return out;
}

export function rebindMap(oldTask: RobotTask | null | undefined, newTask: RobotTask | null | undefined) {
  const att = newTask?.rebind;
  if (!oldTask || !newTask || att?.status !== 'restored' || att.sourceTaskId !== oldTask.taskId) return null;
  if (!Array.isArray(att.ids)) return null;
  const oldIds = taskIds(oldTask),
    newIds = taskIds(newTask);
  if (
    new Set(oldIds).size !== oldIds.length ||
    new Set(newIds).size !== newIds.length ||
    att.ids.length !== oldIds.length ||
    newIds.length !== oldIds.length
  )
    return null;
  const map = new Map(att.ids.map(row => [row.oldId, row.newId]));
  if (
    map.size !== oldIds.length ||
    new Set(map.values()).size !== newIds.length ||
    oldIds.some(id => !map.has(id)) ||
    newIds.some(id => ![...map.values()].includes(id))
  )
    return null;
  const translate = (value: unknown, key?: string): unknown =>
    typeof value === 'string' && ['id', 'current'].includes(key ?? '')
      ? (map.get(value) ?? value)
      : Array.isArray(value)
        ? value.map(item => translate(item))
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, translate(item, name)]))
          : value;
  const meta = (task: RobotTask) => omit(task, ['taskId', 'expiresAt', 'draft', 'rebind']);
  if (JSON.stringify(translate(meta(oldTask))) !== JSON.stringify(meta(newTask))) return null;
  return map;
}

export function mutateOffer(value: unknown, map: Map<string, string>): void {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (typeof item === 'string' && ['id', 'current'].includes(key) && map.has(item)) record[key] = map.get(item);
    else if (item && typeof item === 'object') mutateOffer(item, map);
  }
}

// Presentation follows admitted options, never an assumed Roborock model or service.
export function robotControlGroups(task: RobotTask | null | undefined) {
  const options = task?.domain === 'vacuum' ? task.options : [];
  return {
    cleaning: options.find(o => o.action === 'start' && o.argsSchema.kind === 'cleaning') ?? null,
    settings: options.filter(
      o => o.action === 'set_option' && ['choice', 'number', 'time', 'boolean'].includes(o.argsSchema.kind),
    ),
    transport: options.filter(
      o => ['resume', 'pause', 'return', 'stop'].includes(o.action) && o.argsSchema.kind === 'none',
    ),
    dock: options.filter(o => o.action === 'dock' && o.argsSchema.kind === 'dock'),
    advanced: options.filter(
      o => ['start_all', 'spot_clean', 'locate', 'run_routine'].includes(o.action) && o.argsSchema.kind === 'none',
    ),
    reuse: options.find(o => o.action === 'reuse' && o.argsSchema.kind === 'none') ?? null,
  };
}

export const roomIcon = (label: string): string =>
  `assets/icons/${
    /køkken|kitchen/i.test(label)
      ? 'room-kitchen'
      : /stue|living/i.test(label)
        ? 'room-sofa'
        : /entré|entre|gang|door/i.test(label)
          ? 'room-door'
          : 'robot'
  }.svg`;

export const LEVEL_ICONS: Record<string, string> = {
  mode: 'vacuum',
  suction: 'wind',
  water: 'drop',
  repeat: 'arrow-refresh',
};
