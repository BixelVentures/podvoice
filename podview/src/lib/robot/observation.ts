// The robot's read-only telemetry (the integration's podview.robot.v1 rows) as the Robot screen shows it: facts,
// issues with recovery help, care reminders and the current dock activity. Values cannot enable controls or imply
// physical proof; neither in_cleaning nor a dock state proves task identity, resumption, completion or authority.

export interface TelemetryRow {
  key: string;
  value: unknown;
  unit?: string | null | undefined;
  updatedAt?: number | undefined;
  stale?: boolean | undefined;
}

export interface RobotObserved {
  status?: string | undefined;
  stale?: boolean | undefined;
  live?: boolean | undefined;
  observedAt?: number | null | undefined;
  battery?: number | undefined;
  localJob?: {active?: boolean} | null | undefined;
  telemetry?: {status?: string | undefined; items?: readonly TelemetryRow[]} | undefined;
}

export interface RobotIssue {
  key: string;
  code?: string;
  sources?: {key: string; raw: unknown}[];
  title: string;
  help: string;
  raw: unknown;
  severity: 'attention';
}

export interface RobotReminder {
  key: string;
  name: string;
  title: string;
  help: string;
  value: string;
  severity: 'reminder';
}

export interface RobotExperience {
  activity: string | null;
  jobActive: boolean | null;
  battery: number | null;
  charging: boolean | null;
  dnd: {enabled: boolean | null; start: unknown; end: unknown};
  issues: RobotIssue[];
  maintenance: RobotReminder[];
  stale: boolean;
}

export interface RobotFact {
  label: string;
  value: string;
  stale: boolean;
  group?: string;
}

const LABELS: Readonly<Record<string, string>> = {
  main_brush_time_left: 'Hovedbørste',
  side_brush_time_left: 'Sidebørste',
  filter_time_left: 'Filter',
  sensor_time_left: 'Sensorer',
  cleaning_brush_time_left: 'Dockbørste',
  strainer_time_left: 'Dockfilter',
  mop_drying_remaining_time: 'Tørring tilbage',
  total_cleaning_area: 'Samlet areal',
  total_cleaning_time: 'Samlet tid',
  total_cleaning_count: 'Rengøringer i alt',
  clean_box_empty: 'Rent vand mangler',
  dirty_box_full: 'Snavset vandbeholder fuld',
  water_shortage: 'Vandmangel',
  mop_drying_status: 'Moppetørring',
  mop_drying: 'Moppetørring',
  mop_washing: 'Moppevask',
  dust_emptying: 'Tømning af støvbeholder',
  battery: 'Batteri',
  mop_attached: 'Moppe monteret',
  water_box_attached: 'Vandbeholder monteret',
  battery_charging: 'Oplader',
  child_lock: 'Børnelås',
  dnd_switch: 'Forstyr ikke',
  dnd_start_time: 'Forstyr ikke fra',
  dnd_end_time: 'Forstyr ikke til',
  volume: 'Robotens lydstyrke',
  mop_intensity: 'Moppeintensitet',
  mop_mode: 'Moppetilstand',
  cleaning_mode: 'Rengøringstilstand',
  selected_map: 'Valgt kort',
  dust_collection_mode: 'Tømningstilstand',
  vacuum_error: 'Robotfejl',
  dock_error: 'Dockfejl',
};
const label = (key: string) => LABELS[key] ?? '';

const CARE_KEYS = new Set([
  'main_brush_time_left',
  'side_brush_time_left',
  'filter_time_left',
  'sensor_time_left',
  'cleaning_brush_time_left',
  'strainer_time_left',
]);

const DETAIL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  maintenance: [
    'main_brush_time_left',
    'side_brush_time_left',
    'filter_time_left',
    'sensor_time_left',
    'cleaning_brush_time_left',
    'strainer_time_left',
    'total_cleaning_area',
    'total_cleaning_time',
    'total_cleaning_count',
    'vacuum_error',
  ],
  dock: [
    'mop_drying_remaining_time',
    'clean_box_empty',
    'dirty_box_full',
    'water_shortage',
    'mop_drying_status',
    'mop_drying',
    'mop_washing',
    'dust_emptying',
    'battery',
    'mop_attached',
    'water_box_attached',
    'battery_charging',
    'dock_error',
  ],
  settings: [
    'child_lock',
    'dnd_switch',
    'dnd_start_time',
    'dnd_end_time',
    'volume',
    'mop_intensity',
    'mop_mode',
    'cleaning_mode',
    'selected_map',
    'dust_collection_mode',
  ],
};
const DETAIL_GROUP = new Map(
  Object.entries(DETAIL_GROUPS).flatMap(([group, keys]) => keys.map(key => [key, group] as const)),
);

// Display-only vocabulary for the admitted setting choices; raw values stay with their source.
const SETTING_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  suction: {
    quiet: 'Stille',
    balanced: 'Balanceret',
    turbo: 'Turbo',
    max: 'Maks.',
    max_plus: 'Maks.+',
    off: 'Fra',
    custom: 'Tilpasset',
  },
  cleaning_mode: {vacuum: 'Støvsugning', vac_and_mop: 'Støvsugning og gulvvask', mop: 'Gulvvask', custom: 'Tilpasset'},
  mop_intensity: {
    off: 'Fra',
    low: 'Lav',
    medium: 'Mellem',
    high: 'Høj',
    extreme: 'Extreme',
    custom_water_flow: 'Tilpasset vandmængde',
    custom: 'Tilpasset',
  },
  mop_mode: {standard: 'Standard', deep: 'Grundig', deep_plus: 'Ekstra grundig', fast: 'Hurtig', custom: 'Tilpasset'},
  dust_collection_mode: {smart: 'Smart', light: 'Let', balanced: 'Balanceret', max: 'Maksimal'},
  vacuum_error: {none: 'Ingen'},
  dock_error: {ok: 'Ingen', water_empty: 'Mangler vand'},
};

// Recovery help per reported error (python-roborock error names; Roborock Q Revo care and support articles
// 360035369172 and 360035369312).
const RECOVERY: Readonly<Record<string, Readonly<Record<string, readonly [string, string]>>>> = {
  vacuum_error: {
    lidar_blocked: ['Lasersensoren er blokeret', 'Fjern genstande, der blokerer lasersensoren.'],
    bumper_stuck: [
      'Kofangeren sidder fast',
      'Fjern genstande omkring kofangeren, og kontrollér at den kan bevæge sig.',
    ],
    wheels_suspended: ['Hjulene mangler gulvkontakt', 'Placér robotten på et plant gulv væk fra kanter.'],
    cliff_sensor_error: [
      'Kontrollér faldsensorerne',
      'Rengør faldsensorerne med en blød, tør klud, og flyt robotten væk fra kanter.',
    ],
    main_brush_jammed: [
      'Hovedbørsten sidder fast',
      'Sluk robotten før du fjerner hår og genstande fra hovedbørsten, dens ender og holderne.',
    ],
    side_brush_jammed: ['Sidebørsten sidder fast', 'Sluk robotten, og fjern det, der blokerer sidebørsten.'],
    wheels_jammed: ['Et hjul sidder fast', 'Sluk robotten, og fjern genstande omkring hjulene.'],
    robot_trapped: ['Robotten sidder fast', 'Fjern forhindringer omkring robotten.'],
    no_dustbin: ['Kontrollér støvbeholderen', 'Kontrollér, at støvbeholder og filter er monteret korrekt.'],
    low_battery: ['Batteriet er lavt', 'Lad robotten oplade, før du starter rengøring.'],
    charging_error: [
      'Kan ikke oplade',
      'Kontrollér basens strøm og placering. Rengør robot og bases ladekontakter med en tør klud.',
    ],
    battery_error: [
      'Robotten melder batterifejl',
      'Se den konkrete fejl i Roborock-appen. Kontakt support, hvis fejlen fortsætter.',
    ],
    wall_sensor_dirty: ['Vægsensoren skal rengøres', 'Tør vægsensoren af med en blød, tør klud.'],
    robot_tilted: ['Robotten står skævt', 'Placér robotten på et plant gulv.'],
    return_to_dock_fail: [
      'Kan ikke finde tilbage til basen',
      'Kontrollér, at vejen til basen er fri, og at basen ikke er flyttet.',
    ],
    filter_blocked: [
      'Filteret er blokeret',
      'Kontrollér og rengør filteret efter modellens vejledning. Et vasket filter skal være helt tørt før brug.',
    ],
  },
  dock_error: {
    duct_blockage: [
      'Tømningskanalen er blokeret',
      'Afbryd strømmen til basen før du kontrollerer støvpose, beholdere og tilgængelige luftkanaler.',
    ],
    water_empty: ['Rent vand mangler', 'Fyld beholderen med rent vand, og sæt den korrekt på plads.'],
    waste_water_tank_full: [
      'Snavset vandbeholder er fuld',
      'Tøm beholderen med snavset vand, og sæt den korrekt på plads.',
    ],
    dirty_tank_latch_open: [
      'Vandbeholderen er ikke lukket',
      'Luk beholderens låg og lås, og kontrollér at beholderen sidder korrekt.',
    ],
    no_dustbin: ['Kontrollér basens støvbeholder', 'Kontrollér støvpose og dæksel på basen.'],
    cleaning_tank_full_or_blocked: [
      'Vaskebakken skal kontrolleres',
      'Kontrollér og rengør den aftagelige vaskebakke og dens filter efter modellens vejledning.',
    ],
  },
};

const ERROR_NUMBERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  vacuum_error: {
    1: 'lidar_blocked',
    2: 'bumper_stuck',
    3: 'wheels_suspended',
    4: 'cliff_sensor_error',
    5: 'main_brush_jammed',
    6: 'side_brush_jammed',
    7: 'wheels_jammed',
    8: 'robot_trapped',
    9: 'no_dustbin',
    12: 'low_battery',
    13: 'charging_error',
    14: 'battery_error',
    15: 'wall_sensor_dirty',
    16: 'robot_tilted',
    23: 'return_to_dock_fail',
    29: 'filter_blocked',
  },
  dock_error: {
    34: 'duct_blockage',
    38: 'water_empty',
    39: 'waste_water_tank_full',
    44: 'dirty_tank_latch_open',
    46: 'no_dustbin',
    53: 'cleaning_tank_full_or_blocked',
  },
};

const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  washing_the_mop: 'Vasker moppe',
  washing_mop: 'Vasker moppe',
  going_to_wash_the_mop: 'På vej til moppevask',
  going_to_wash_mop: 'På vej til moppevask',
  emptying_the_bin: 'Tømmer støvbeholder',
  emptying_dustbin: 'Tømmer støvbeholder',
  drying_the_mop: 'Tørrer moppe',
  drying_mop: 'Tørrer moppe',
};

const WATER_RECOVERY: Readonly<Record<string, readonly [string, string]>> = {
  clean_box_empty: ['Rent vand mangler', 'Fyld beholderen med rent vand, og sæt den korrekt på plads.'],
  dirty_box_full: ['Snavset vandbeholder er fuld', 'Tøm beholderen med snavset vand, og sæt den korrekt på plads.'],
  water_shortage: ['Robotten mangler vand', 'Kontrollér beholderen med rent vand og dens placering.'],
};

const NO_ERROR = ['none', 'no_error', 'ok', '0'];
const own = <T>(table: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  table && Object.hasOwn(table, key) ? table[key] : undefined;
const rowsOf = (device: RobotObserved | null | undefined): readonly TelemetryRow[] =>
  device?.telemetry?.status === 'observed' ? (device.telemetry.items ?? []) : [];
const number = (n: number) => n.toLocaleString('da-DK', {maximumFractionDigits: 1});
export const dateLabel = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString('da-DK', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

// One telemetry value as text: Ja/Nej, the setting's Danish name, minutes, m², %.
export function robotValue(row: TelemetryRow): string {
  const {value, unit} = row;
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej';
  if (typeof value === 'string') {
    const clock = ['dnd_start_time', 'dnd_end_time'].includes(row.key);
    if (clock && value.length === 8 && /^(?:[01]\d|2[0-3]):[0-5]\d:00$/.test(value)) return value.slice(0, 5);
    const vocabulary = own(SETTING_LABELS, row.key);
    if (vocabulary) return own(vocabulary, value) ?? value;
    return value.replaceAll('_', ' ');
  }
  if (typeof value !== 'number') return '';
  if (CARE_KEYS.has(row.key) && (unit === 's' || unit === 'min' || unit === 'h')) {
    const magnitude = Math.abs(value);
    const amount = unit === 's' ? magnitude / 60 : magnitude;
    const name = unit === 'h' ? (amount === 1 ? 'time' : 'timer') : 'min';
    return `${number(amount)} ${name} ${value < 0 ? 'over interval' : 'tilbage'}`;
  }
  if (unit === 's') return `${number(value / 60)} min`;
  if (unit === 'min' || unit === 'h') return `${number(value)} ${unit === 'h' ? 'timer' : 'min'}`;
  if (unit === 'm²') return `${number(value)} m²`;
  if (unit === '%') return `${number(value)} %`;
  return number(value);
}

const recent = (row: TelemetryRow, now: number) => typeof row.updatedAt === 'number' && now - row.updatedAt <= 300;

// The room the robot reports while it cleans, when that report is fresh.
export function robotRoom(device: RobotObserved, now = Date.now() / 1000): string | null {
  if (device.status !== 'cleaning' || device.stale) return null;
  const row = rowsOf(device).find(item => item.key === 'current_room');
  return row && !row.stale && recent(row, now) && typeof row.value === 'string' ? row.value : null;
}

export function robotFacts(device: RobotObserved, now = Date.now() / 1000) {
  const items = rowsOf(device);
  const fresh = (row: TelemetryRow) => !device.stale && !row.stale && recent(row, now);
  const byKey = new Map(items.map(row => [row.key, row]));
  const summary: string[] = [];
  if (device.status === 'cleaning' && !device.stale) {
    const room = byKey.get('current_room');
    if (room && fresh(room) && typeof room.value === 'string') summary.push(room.value);
    for (const key of ['clean_percent', 'cleaning_area', 'cleaning_time']) {
      const row = byKey.get(key);
      if (row && fresh(row)) summary.push(robotValue(row));
    }
  }
  const history: RobotFact[] = [];
  for (const key of ['last_clean_start', 'last_clean_end']) {
    const row = byKey.get(key);
    if (!row || typeof row.value !== 'number') continue;
    const name = key === 'last_clean_start' ? 'Senest startet' : 'Senest afsluttet';
    history.push({label: name, value: dateLabel(row.value), stale: !fresh(row)});
  }
  const attention = ['clean_box_empty', 'dirty_box_full', 'water_shortage']
    .map(key => byKey.get(key))
    .filter((row): row is TelemetryRow => row?.value === true && fresh(row))
    .map(row => label(row.key));
  for (const key of ['vacuum_error', 'dock_error']) {
    const row = byKey.get(key);
    if (row && fresh(row) && typeof row.value === 'string' && !NO_ERROR.includes(row.value.toLowerCase())) {
      attention.push(`${label(key)}: ${robotValue(row)}`);
    }
  }
  const details: RobotFact[] = items
    .filter(row => label(row.key))
    .map(row => {
      const group = DETAIL_GROUP.get(row.key);
      return {label: label(row.key), value: robotValue(row), stale: !fresh(row), ...(group ? {group} : {})};
    });
  return {summary, history, attention, details};
}

// One bounded projection for the Robot screen, Hjem and Ro.
export function robotExperience(device: RobotObserved | null | undefined, now = Date.now() / 1000): RobotExperience {
  const stale = !!device?.stale || ['unavailable', 'unknown'].includes(device?.status ?? '');
  const rows = rowsOf(device);
  const fresh = (row: TelemetryRow | undefined): row is TelemetryRow =>
    !stale && !!row && !row.stale && typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) &&
    row.updatedAt <= now + 1 && now - row.updatedAt <= 300;
  const get = (key: string) => {
    const row = rows.find(item => item.key === key);
    return fresh(row) ? row : null;
  };
  const value = (key: string) => get(key)?.value;
  const flag = (key: string) => {
    const v = value(key);
    return typeof v === 'boolean' ? v : null;
  };
  const issues: RobotIssue[] = [];
  for (const key of ['vacuum_error', 'dock_error']) {
    const row = get(key);
    if (!row || typeof row.value !== 'string' || NO_ERROR.includes(row.value.toLowerCase())) continue;
    const raw = row.value;
    const normal = raw.toLowerCase();
    const code = own(ERROR_NUMBERS[key], normal) ?? normal;
    const known = own(RECOVERY[key], code);
    issues.push({
      key,
      code,
      sources: [{key, raw}],
      title: known?.[0] ?? (key === 'dock_error' ? 'Basen melder en fejl' : 'Robotten melder en fejl'),
      help: known?.[1] ?? 'Se den konkrete fejl i Roborock-appen eller modellens vejledning.',
      raw,
      severity: 'attention',
    });
  }
  for (const [key, [title, help]] of Object.entries(WATER_RECOVERY)) {
    if (value(key) !== true) continue;
    const same = issues.find(issue => issue.title === title);
    if (same) same.sources?.push({key, raw: true});
    else issues.push({key, sources: [{key, raw: true}], title, help, raw: true, severity: 'attention'});
  }
  // Related water symptoms share guidance only when a fresh clean-tank fault is also reported. Each source signal is
  // kept for diagnosis; a tank fault is never inferred from the robot's generic water-shortage signal alone.
  const tank = issues.find(
    issue => issue.key === 'clean_box_empty' || (issue.key === 'dock_error' && issue.code === 'water_empty'),
  );
  const shortage = issues.find(issue => issue.key === 'water_shortage');
  if (tank && shortage) {
    tank.sources?.push(...(shortage.sources ?? []));
    issues.splice(issues.indexOf(shortage), 1);
  }
  const maintenance: RobotReminder[] = rows
    .filter(row => CARE_KEYS.has(row.key) && fresh(row) && typeof row.value === 'number' && row.value <= 0)
    .map(row => ({
      key: row.key,
      name: label(row.key),
      title: label(row.key),
      help:
        'Robotten melder, at vedligeholdelsesintervallet er nået. Se modellens vejledning for ' +
        `${label(row.key).toLocaleLowerCase('da-DK')}. Nulstil kun intervallet efter udført vedligeholdelse.`,
      value: robotValue(row),
      severity: 'reminder',
    }));
  const jobActive = flag('in_cleaning');
  const charging = flag('battery_charging');
  const batteryValue = value('battery');
  const battery = typeof batteryValue === 'number' ? batteryValue : null;
  // dnd_switch is the enabled schedule, not proof that DND is active right now.
  const dnd = {enabled: flag('dnd_switch'), start: value('dnd_start_time') ?? null, end: value('dnd_end_time') ?? null};
  let activity: string | null = null;
  const status = device?.status ?? '';
  if (!stale && !['fault', 'error', 'unavailable', 'unknown'].includes(status) &&
    device?.telemetry?.status === 'observed') {
    const reported = value('status');
    const operations = (
      [['mop_washing', 'Vasker moppe'], ['dust_emptying', 'Tømmer støvbeholder'], ['mop_drying', 'Tørrer moppe']] as const
    ).filter(([key]) => value(key) === true) as (readonly [string, string])[];
    if (value('mop_drying_status') === true && !operations.some(([key]) => key === 'mop_drying')) {
      operations.push(['mop_drying_status', 'Tørrer moppe']);
    }
    // A specific fresh robot status resolves disagreeing switch reports. Without it there is no invented
    // washing/emptying/drying priority or charging fallback.
    const named = typeof reported === 'string' ? own(ACTIVITY_LABELS, reported) : undefined;
    if (named) activity = named;
    else if (operations.length > 1) {
      issues.push({
        key: 'dock_activity_conflict',
        title: 'Basens aktivitet er uklar',
        help: 'Flere aktiviteter meldes aktive. Afvent en ny status, eller kontrollér Roborock-appen.',
        raw: operations.map(([key]) => key).join(', '),
        severity: 'attention',
      });
    } else if (operations[0]) activity = operations[0][1];
    else if (['docked', 'stopped'].includes(status)) {
      if (charging === true || (reported === 'charging' && charging !== false)) {
        activity = jobActive === true ? 'Oplader · turen er ikke afsluttet' : 'Oplader';
      } else if (reported === 'charging_complete') activity = 'Opladet';
    }
  }
  return {activity, jobActive, battery, charging, dnd, issues, maintenance, stale};
}

// The last observed activity, also while the device is stale (the label says »Ikke opdateret« itself).
export function robotActivity(device: RobotObserved, now = Date.now() / 1000): string | null {
  return robotExperience(device.stale ? {...device, stale: false} : device, now).activity;
}

const LIVE_STATUS: Readonly<Record<string, string>> = {
  paused: 'Rengøring på pause',
  docking: 'På vej til basen',
  docked: 'I basen',
  complete: 'Rengøring afsluttet',
  stopped: 'Ingen aktiv rengøring',
  fault: 'Robotten melder en fejl',
  unknown: 'Status ukendt',
  unavailable: 'Robotten er ikke tilgængelig',
};
const LOCAL_STATUS: Readonly<Record<string, string>> = {
  cleaning: 'Rengør',
  paused: 'Rengøring på pause',
  docking: 'På vej til basen',
  docked: 'I basen',
  complete: 'Rengøring afsluttet',
  fault: 'Børste blokeret · se enheden',
  unknown: 'Status ukendt',
  stopped: 'Rengøring stoppet',
};

// The robot's one-line status: a reported issue first, then the dock activity, then the vacuum's state.
export function robotLabel(device: RobotObserved): string {
  const experience = robotExperience(device);
  const activity = robotActivity(device);
  if (experience.issues[0]) return experience.issues[0].title;
  if (activity) return (device.stale ? 'Ikke opdateret: ' : '') + activity;
  const status = device.status ?? '';
  if (!device.live) return own(LOCAL_STATUS, status) ?? 'Status ukendt';
  const room = robotRoom(device);
  const text = status === 'cleaning' ? (room ? `Robotten er i ${room}` : 'Rengør') : own(LIVE_STATUS, status);
  return (device.stale ? 'Ikke opdateret: ' : '') + (text ?? 'Status ukendt');
}

interface OverviewFact {
  id: string;
  label: string;
  value: string;
  stale: boolean;
}

// Bounded read-only facts for the Robot hero. Missing telemetry is omitted; a status or accepted command never
// manufactures a fact.
function robotOverviewFacts(device: RobotObserved, now: number): OverviewFact[] {
  const facts: OverviewFact[] = [];
  const active = ['cleaning', 'paused'].includes(device.status ?? '');
  const byKey = new Map(
    rowsOf(device)
      .filter(row => typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) && row.updatedAt <= now + 1)
      .map(row => [row.key, row]),
  );
  const fields: [string, string][] = [
    ['current_room', active ? 'Rum' : 'Senest observeret rum'],
    ['cleaning_area', active ? 'Rengjort areal' : 'Seneste areal'],
    ['cleaning_time', active ? 'Forløbet' : 'Seneste varighed'],
    ['clean_percent', 'Fremdrift'],
    ['battery', 'Batteri'],
    ['cleaning_mode', 'Tilstand'],
    ['selected_map', 'Kort'],
    ['last_clean_end', 'Senest afsluttet'],
    ['last_clean_start', 'Senest startet'],
  ];
  for (const [id, name] of fields) {
    const row = byKey.get(id);
    if (row?.value === null || row?.value === undefined || row.value === '') continue;
    const stale = device.stale === true || row.stale === true || now - (row.updatedAt ?? 0) > 300;
    if (['current_room', 'clean_percent'].includes(id) && (!active || stale)) continue;
    const timestamp = id === 'last_clean_end' || id === 'last_clean_start';
    if (timestamp && (typeof row.value !== 'number' || row.value <= 0 || row.value > now + 1)) continue;
    const value = timestamp && typeof row.value === 'number' ? dateLabel(row.value) : robotValue(row);
    facts.push({id, label: name, value, stale});
  }
  const battery = device.battery;
  if (!facts.some(fact => fact.id === 'battery') && typeof battery === 'number' && battery >= 0 && battery <= 100) {
    const fact = {id: 'battery', label: 'Batteri', value: `${battery.toLocaleString('da-DK')} %`, stale: !!device.stale};
    facts.splice(Math.min(3, facts.length), 0, fact);
  }
  return facts;
}

// The Robot hero's one metadata line: battery, the last or current measurements, and when it was last read.
export function robotDetailMetadata(device: RobotObserved, now = Date.now() / 1000): string {
  const facts = robotOverviewFacts(device, now);
  const format = (fact: OverviewFact) => `${fact.value}${fact.stale ? ' · ikke opdateret' : ''}`;
  const battery = facts.find(fact => fact.id === 'battery');
  const measurements = ['cleaning_area', 'cleaning_time']
    .map(id => facts.find(fact => fact.id === id))
    .filter((fact): fact is OverviewFact => !!fact)
    .map(format)
    .join(' · ');
  const active = ['cleaning', 'paused'].includes(device.status ?? '');
  const at = device.observedAt;
  const lastRead =
    device.live === true && device.stale === true && typeof at === 'number' && at > 0 && at <= now + 1
      ? `Sidst opdateret kl. ${new Date(at * 1000).toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'})}`
      : '';
  const wasIdle = !robotExperience(device).jobActive && !(device.live !== true && device.localJob?.active === true);
  return [
    battery ? `Batteri ${format(battery)}` : '',
    measurements && (wasIdle || active) ? `${active ? '' : 'Senest: '}${measurements}` : '',
    lastRead,
  ]
    .filter(Boolean)
    .join(' · ');
}
