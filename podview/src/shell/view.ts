// What the shell's React tree shows, as plain data. The host (widget-view.js) derives it from its state machine and
// sets it on the ShellStore; nothing here reads the DOM. The initial view is the markup podview/index.html had.

// The host's methods the shell's controls call (widget-view.js implements them).
export interface ShellHost {
  readonly live: boolean;
  headerBackAction(): void;
  headerTitleBack(): void;
  showFocus(id: string, focusHeading?: boolean): void;
  showMusicFromTopbar(): void;
  openSvar(): void;
  openScreenSettings(opener: HTMLElement): void;
  open(id: string, opener?: Element | null): void;
  closeDialog(id: string): void;
  dialogClosed(id: string): void;
  focusPlayPause(): void;
  restoreResources(): void;
  restoreTimer(): void;
  openRecipes(): void;
  openRest(): void;
  deviceBack(): void;
  openHistoryAnswer(id: string): void;
  togglePin(): void;
  hideWidget(): void;
  resolveConflict(choice: 'continue' | 'replace'): void;
  chooseDemoTarget(target: DemoTarget, revision: number): void;
  demoScenario(kind: string): void;
  demoFault(kind: string): void;
  demoDevice(kind: string): void;
  demoObserve(status: string): void;
  demoMusic(): void;
  demoNow(): void;
  demoTimer(): void;
  demoOffline(): void;
  demoEnd(): void;
  retryConnection(): void;
  screenBrightness(value: number): void;
  screenAutoDim(): void;
  screenAdmin(event: MouseEvent, link: HTMLAnchorElement): void;
}

export interface TopbarView {
  title: string;
  // A detail page: the title is the Back button (arrow and title in one).
  back: boolean;
  // The overview's Ro key (moon + »Ro«) shows on Hjem only.
  rest: boolean;
  nowPressed: boolean | null;
  musicPressed: boolean | null;
  svarActive: boolean | null;
  // U2: the room's Voice PE is offline; the Svar button reads »Offline« on grey.
  svarOffline: boolean;
  historyCount: string;
}

export interface ClockView {
  // The connection's short label replaces the date (»Offline«); its full text is the accessible name.
  headerDate: string;
  photoDate: string;
  label: string | null;
  connectionState: string | null;
  offline: boolean;
  night: boolean;
  connectionMark: boolean;
  roDescription: string;
}

export interface HomeRowsView {
  activities: string | null;
  summary: string;
  musicLabel: string;
  track: string;
  restoreResources: boolean;
  vehicleStatus: string;
}

// The Opskrifter card: a recipe in progress shows its name, »Trin N af M« and a step bar (K-Widget »igang«).
export interface RecipeCardView {
  heading: string;
  status: string;
  name: string;
  steps: number;
  current: number;
}

export interface HistoryRow {
  id: string;
  icon: string;
  title: string;
  excerpt: string;
  format: string;
  label: string;
  hidden: boolean;
}

export interface InlineStatusData {
  state: string;
  quietStatus?: boolean;
  text?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface HistoryView {
  // The first answer of each round in first-shown order; the other answers' rows follow, hidden.
  rows: HistoryRow[];
  empty: InlineStatusData;
  emptyHidden: boolean;
  exampleNoteHidden: boolean;
  listHidden: boolean;
}

export interface ScreenView {
  deviceState: 'example' | 'unbound' | null;
  note: string;
  brightness: number;
  brightnessText: string;
  enabled: boolean;
  autoDim: boolean;
  autoText: string;
  dimRule: string;
  wifi: string;
  browser: string;
  home: string;
  homeLabel: string | null;
  info: string;
  enrollmentHref: string | null;
  adminHref: string | null;
}

// The connection's »Prøv igen« (in »Om skærmen«, or moved into the toast by the notification queue).
export interface RetryView {
  hidden: boolean;
  busy: boolean;
}

export interface DemoTarget {
  accountId: string;
  kind: string;
  targetId: string;
  name: string;
  detail: string;
}

export interface DemoView {
  connected: boolean;
  hasVacuum: boolean;
  targets: {target: DemoTarget; detail: string; selected: boolean; disabled: boolean; revision: string}[];
}

export interface CustomizeView {
  pinned: boolean;
  hideDisabled: boolean;
}

export interface ShellView {
  topbar: TopbarView;
  clock: ClockView;
  home: HomeRowsView;
  recipe: RecipeCardView;
  history: HistoryView;
  screen: ScreenView;
  retry: RetryView;
  demo: DemoView;
  customize: CustomizeView;
}

export const INITIAL_VIEW: ShellView = {
  topbar: {
    title: 'Lige nu',
    back: false,
    rest: true,
    nowPressed: null,
    musicPressed: null,
    svarActive: null,
    svarOffline: false,
    historyCount: '',
  },
  clock: {
    headerDate: '',
    photoDate: '',
    label: null,
    connectionState: null,
    offline: false,
    night: false,
    connectionMark: false,
    roDescription: 'Åbn Skærm og enhed',
  },
  home: {
    activities: null,
    summary: 'Det, der er i gang',
    musicLabel: 'Musik',
    track: '',
    restoreResources: false,
    vehicleStatus: 'Ikke forbundet',
  },
  recipe: {heading: 'Opskrifter', status: 'Se katalog', name: '', steps: 0, current: -1},
  history: {
    rows: [],
    empty: {
      state: 'empty',
      quietStatus: true,
      text: 'Ingen visuelle svar endnu',
      detail: 'Her samles dine visuelle svar.',
    },
    emptyHidden: false,
    exampleNoteHidden: true,
    listHidden: false,
  },
  screen: {
    deviceState: null,
    note: 'Enhedsstyring er ikke tilsluttet.',
    brightness: 0,
    brightnessText: 'Ikke oplyst',
    enabled: false,
    autoDim: false,
    autoText: 'Ikke oplyst',
    dimRule: 'Indstilles på den fysiske skærm.',
    wifi: 'Ikke oplyst',
    browser: 'Ikke oplyst',
    home: 'Ikke tilsluttet',
    homeLabel: null,
    info: 'Denne skærm',
    enrollmentHref: null,
    adminHref: null,
  },
  retry: {hidden: true, busy: false},
  demo: {connected: true, hasVacuum: false, targets: []},
  customize: {pinned: false, hideDisabled: false},
};
