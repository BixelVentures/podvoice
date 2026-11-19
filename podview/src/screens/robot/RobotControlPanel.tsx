// Robot: the robot control panel, the custom element pv-robot-control-panel that the live device detail
// (live-control-view.js) and the local preview (local-robot-view.js) host. Same element contract as the pre-React
// robot-control-panel.js: the hosts set `data` and `disabled` and call observed(), suggest(), validSuggestion(),
// readCleaningDraft(), applyCleaningDraft(), readModeDrafts() and applyModeDrafts(); the panel emits
// robot-control-action, robot-direct-action, robot-control-expired-start and robot-draft-changed. The named parts
// (observation, transportControls, cleaningSubmit, settingControls, startSettingControls, mapControl,
// baseDisclosure, confirmation, ...) are the drawn elements, as before. The controller's rules are unchanged: Start
// and the room draft stay live while a robot command runs, a second Start gets a message instead of a queue, stale
// data locks the controls at once, an unknown outcome is shown and never resent, a renewal keeps the controls only
// when the owner attests it. The controller keeps what each element shows (screen.ts) and React draws it
// (RobotPanel.tsx) synchronously (flushSync), so the panel is current when a call returns. Native element state stays
// native: checked rooms and radios, the floor select's value, typed numbers, the dialog, focus, the hero's own
// pv-vacuum-widget anatomy and its data. The proposal caption, button and zone and the setup summary were never
// placed in the page; they stay detached native elements.
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {applyKitComponent, applyKitTextRole, createKitComponent} from '../../../ui/kit.js';
import {robotExperience, robotFacts, robotRoom} from '../../../robot-observation.js';
import {controlArgs} from '../../../control-model.js';
import {deviceLabel, robotDetailMetadata} from '../../../scene-model.js';
import {
  activeJob,
  choiceLabel,
  cleaningMode,
  compactSetting,
  frequentSetting,
  irrelevantSetting,
  LEVEL_ICONS,
  mutateOffer,
  rebindMap,
  robotControlGroups,
  roomIcon,
  sameTaskContent,
  settingConcept,
  settingLabel,
  settingOrder,
  specialChoice,
  specialSelection,
  visibleSettingChoices,
} from './model';
import type {RobotChoice, RobotDevice, RobotOption, RobotStartSetting, RobotTask} from './model';
import {
  addClasses,
  attr,
  changes,
  emptyScreen,
  face,
  hasClass,
  kit,
  made,
  removeAttr,
  setAttr,
  setClass,
  setDisabled,
  setHidden,
  setStyle,
  setText,
  textRole,
  touch,
} from './screen';
import type {
  Base,
  CleaningSection,
  Face,
  MapPart,
  MapSelect,
  Part,
  Rail,
  RobotScreen,
  RoomTile,
  Section,
  Sticky,
  TransportItem,
} from './screen';
import {RobotPanel} from './RobotPanel';

export {robotControlGroups} from './model';
export type {RobotOption, RobotTask, RobotDevice} from './model';

let cleaningSerial = 0,
  buildSerial = 0;

export interface CurrentSetup {
  mapName?: unknown;
  repeat?: unknown;
  repeatRange?: {min?: unknown; max?: unknown} | undefined;
  areas?: unknown;
}

export interface PanelValue {
  task?: RobotTask | null | undefined;
  device?: RobotDevice | null | undefined;
  connected?: boolean | undefined;
  localOnly?: boolean | undefined;
  readOnly?: boolean | undefined;
  loading?: boolean | undefined;
  selectedAreaId?: string | null | undefined;
  presentationScope?: PresentationScope | null | undefined;
  pendingOptionId?: string | null | undefined;
  pendingChoiceId?: string | null | undefined;
  pendingValue?: number | null | undefined;
  directActions?: string[] | undefined;
  directBlocked?: boolean | undefined;
  directReadGap?: boolean | undefined;
  directPendingAction?: string | null | undefined;
  currentSetup?: CurrentSetup | null | undefined;
  settingValues?: Record<string, unknown> | undefined;
  controlFeedback?: {text?: unknown; state?: string} | null | undefined;
  history?: unknown;
}

interface PresentationScope {
  bootId?: unknown;
  roomId?: unknown;
  deviceId?: unknown;
  transport?: unknown;
  generation?: unknown;
}

export interface CleaningDraft {
  areaIds: string[];
  repeat: number | null;
  settingChoices?: {settingId: string; choiceId: string}[];
}

interface DraftInput {
  areaIds?: unknown;
  repeat?: unknown;
  settingChoices?: unknown;
  settings?: unknown;
}

interface ModeDraft {
  settings: Map<string, string | null>;
  repeat: number | null;
}

export interface SavedModeDrafts {
  ok: boolean;
  items: {mode: string | undefined; settings: {key: string | undefined; label: string | null}[]; repeat: number}[];
}

interface Suggestion {
  schema: string;
  source: string;
  basis: string;
  bootId: unknown;
  roomId: unknown;
  taskId: unknown;
  revision: unknown;
  expiresAt: number;
  recipeId: string;
  optionId: string;
  areaIds: string[];
  repeat: number;
}

export interface RailHandle {
  model: Rail;
  // The »Aktuel indstilling« note, once a special current value needed one.
  readonly specialNote: HTMLElement | undefined;
  readonly node: HTMLFieldSetElement;
  readonly inputs: HTMLInputElement[];
  readonly legend: HTMLLegendElement | null;
  setValue: (next: string | null | undefined) => void;
  setDisabled: (value: boolean) => void;
  setChoiceDisabled: (choice: string, disabled: boolean) => void;
}

export interface StartSettingControl {
  setting: RobotStartSetting;
  selected: string | null;
  rail: RailHandle;
  readonly buttons: HTMLFieldSetElement;
  unavailable?: boolean;
}

export interface SettingControl {
  option: RobotOption;
  rail?: RailHandle;
  numeric?: true;
  readonly toggle?: HTMLButtonElement;
  readonly wrapper?: HTMLElement;
  readonly readOnly?: HTMLElement;
  readonly group?: HTMLFieldSetElement;
  faces: {wrapper?: Face; value?: Face; toggle?: Face};
}

interface IndirectControl {
  choiceId: string | null;
  rail?: RailHandle;
}

export interface Disclosure {
  readonly node: HTMLElement;
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  setExpanded: (value: boolean) => void;
  setDescription: (value: string) => void;
  setDisabled: (value: boolean) => void;
}

interface MapControl {
  option: RobotOption;
  readonly select: HTMLSelectElement;
  paint: () => void;
}

type VacuumWidget = HTMLElement & {
  data?: unknown;
  init?: () => void;
  stateNote?: Element;
  content?: Element;
  icon?: Element;
};

type Detached = HTMLElement & {open?: boolean};

const settingCurrent = (value: PanelValue | undefined, option: RobotOption): unknown =>
  Object.hasOwn(value?.settingValues ?? {}, option.id)
    ? value?.settingValues?.[option.id]
    : option.argsSchema.current;

const ownRobotPending = (value: PanelValue): boolean =>
  !!value.pendingOptionId &&
  value.task?.domain === 'vacuum' &&
  value.task.options.some(option => option.id === value.pendingOptionId);
const foreignRobotPending = (value: PanelValue): boolean =>
  !!(value.pendingOptionId || value.device?.pending) && !ownRobotPending(value);
// A pending Pause/Fortsæt does not cancel an open confirmation; its tap is queued (S3).
const directConfirmationCurrent = (action: string, value: PanelValue): boolean =>
  value.connected !== false &&
  !value.directBlocked &&
  !foreignRobotPending(value) &&
  (value.device?.stale
    ? action === 'return' && value.directReadGap === true
    : !!value.directActions?.includes(action));

const expiredOffer = (task: RobotTask | null | undefined): boolean =>
  Number.isFinite(task?.expiresAt) && (task?.expiresAt ?? 0) * 1000 <= Date.now();

const NOT_RESTORED = 'Dine tidligere valg kunne ikke genskabes. Vælg rum og indstillinger igen.';
const TRANSPORT_ICONS: Record<string, string> = {
  pause: 'pause-fill',
  resume: 'play-fill',
  return: 'arrow-u-down-left',
  stop: 'x-lg',
};

// A detached element as the old make() built it (the proposal parts and the setup summary).
function detached(tag: string, text: string | undefined, className: string, role: string | null): Detached {
  const node: Detached = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  if (role) applyKitTextRole(node, role);
  return node;
}

// Node (the legacy node:test suite) has no DOM; the class must still load there.
const HTMLBase: typeof HTMLElement =
  'HTMLElement' in globalThis ? HTMLElement : (Object as unknown as typeof HTMLElement);

export class RobotControlPanel extends HTMLBase {
  readonly content: HTMLDivElement;
  value: PanelValue | undefined;
  renewalDiagnostic: string | null = null;
  draftFeedback: string | null = null;
  cleaningDirty = false;
  cleaningApplied = false;
  historyApplied = false;
  cleaningOptionId: string | null = null;
  baseExpanded = false;
  care = null;
  careSignature = null;
  dockSection = null;
  moreSection = null;
  advancedSettings = null;
  endDisclosure = null;
  readCleaningDraft: (() => CleaningDraft) | null = null;
  applyCleaningDraft: ((draft: DraftInput) => boolean) | null = null;
  rebindCleaningDrafts: ((map: Map<string, string>) => void) | null = null;
  readModeDrafts: (() => SavedModeDrafts) | null = null;
  applyModeDrafts: ((saved: SavedModeDrafts | null | undefined) => boolean) | null = null;
  refreshCleaningSummary: (() => void) | null = null;
  settingControls: SettingControl[] = [];
  startSettingControls: StartSettingControl[] = [];
  indirectChoiceControls: IndirectControl[] = [];
  mapControl: MapControl | null = null;
  baseDisclosure: Disclosure | null = null;
  repeatReadOnlyRail: RailHandle | null = null;
  proposalButton: Detached | null = null;
  proposalCaption: Detached | null = null;
  proposalZone: Detached | null = null;
  proposalSignature: string | null = null;
  currentSuggestion: Suggestion | null = null;
  cleaningOptionsSummary: Detached | null = null;
  confirmationOpener: Element | null = null;
  stickyLine: {readonly line: HTMLElement} | null = null;
  _disabled = false;
  private screen: RobotScreen = emptyScreen();
  private root: Root | null = null;
  private painted = -1;
  private depth = 0;
  private elements = new Map<string, Element>();
  // Elements of an earlier build: a part a host or test kept (an old disclosure, rail or row) is still that element.
  private retired = new Map<string, WeakRef<Element>>();
  private ids = new WeakMap<Element, string>();
  private refs = new Map<string, (node: Element | null) => void>();
  private faceIndex = new Map<string, Face>();
  private pending = new Map<string, [string, EventListener][]>();
  private rails: {handle: RailHandle; value: () => string | null | undefined; applied: boolean}[] = [];
  private initialized: Element | null = null;
  private directTransportSignature: string | null = null;
  private currentAreasSignature: string | null = null;
  private stickyObserver: IntersectionObserver | null = null;
  private stickyMutations: MutationObserver | null = null;
  private stickyFrame = 0;
  private faces: {
    submit: Face | null;
    form: Face | null;
    availability: Face | null;
    currentMap: Face | null;
    currentRooms: (Section & {kind: 'current-rooms'}) | null;
    repeatStatus: Face | null;
    cleaningOptions: (Part & {kind: 'group'}) | null;
    cleaningTypeOptions: (Part & {kind: 'group'}) | null;
    base: Base | null;
  } = {
    submit: null,
    form: null,
    availability: null,
    currentMap: null,
    currentRooms: null,
    repeatStatus: null,
    cleaningOptions: null,
    cleaningTypeOptions: null,
    base: null,
  };

  constructor() {
    super();
    this.content = document.createElement('div');
    this.content.className = 'pv-component robot-control-panel';
  }

  // ----- drawing -----

  private readonly bind = (id: string): ((node: Element | null) => void) => {
    let ref = this.refs.get(id);
    if (!ref) {
      ref = (node: Element | null) => {
        if (node) {
          this.elements.set(id, node);
          this.ids.set(node, id);
        } else {
          const old = this.elements.get(id);
          if (old) this.retired.set(id, new WeakRef(old));
          this.elements.delete(id);
        }
      };
      this.refs.set(id, ref);
    }
    return ref;
  };

  private run<T>(step: () => T): T {
    this.depth++;
    try {
      return step();
    } finally {
      this.depth--;
      if (this.depth === 0) this.paint();
    }
  }

  private indexFaces(): void {
    const index = new Map<string, Face>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string' && record.attrs && typeof record.className === 'string') {
        index.set(record.id, value as Face);
        return;
      }
      for (const item of Object.values(record)) visit(item);
    };
    visit(this.screen);
    this.faceIndex = index;
  }

  private paint(): void {
    if (this.painted === changes.count) return;
    this.root ??= createRoot(this.content);
    const root = this.root;
    this.indexFaces();
    const screen = structuredClone(this.screen);
    flushSync(() => {
      root.render(<RobotPanel screen={screen} bind={this.bind} />);
    });
    this.painted = changes.count;
    this.afterPaint();
  }

  // Native writes after React's commit: listeners on new elements, exact style attributes, the floor select's
  // value, the progress value, radios that were given a value before they existed, and the hero's own anatomy.
  private afterPaint(): void {
    for (const [id, listeners] of [...this.pending]) {
      const node = this.elements.get(id);
      if (!node) continue;
      for (const [type, listener] of listeners) node.addEventListener(type, listener);
      this.pending.delete(id);
    }
    for (const target of this.faceIndex.values()) {
      if (target.style === null) continue;
      const node = this.elements.get(target.id);
      if (node && node.getAttribute('style') !== target.style) node.setAttribute('style', target.style);
    }
    for (const button of Object.values(this.screen.actions)) {
      if (button.icon.tag !== 'span') continue;
      const icon = this.elements.get(`${button.face.id}-icon`);
      const style = `--pv-icon-source:url("${button.icon.src}")`;
      if (icon && icon.getAttribute('style') !== style) icon.setAttribute('style', style);
      // The old Stop icon was a kit icon span given an image's properties (src, alt, width, height).
      if (icon && Reflect.get(icon, 'src') !== button.icon.src)
        Object.assign(icon, {src: button.icon.src, alt: '', width: 24, height: 24});
    }
    for (const section of this.screen.sections) {
      if (section.kind !== 'cleaning' || !section.allContent) continue;
      const icon = this.elements.get(`${section.all.id}-icon`);
      const style = `--pv-icon-source:url("${section.allContent.icon}")`;
      if (icon && icon.getAttribute('style') !== style) icon.setAttribute('style', style);
    }
    for (const map of this.maps()) this.applySelect(map);
    const hero = this.screen.hero;
    if (hero) {
      const meter = this.elements.get(`${hero.progress.id}-meter`) as HTMLProgressElement | undefined;
      if (meter && hero.meter !== null && meter.value !== hero.meter) meter.value = hero.meter;
      const observation = this.elements.get(hero.observation.id) as VacuumWidget | undefined;
      if (observation && this.initialized !== observation) {
        this.initialized = observation;
        observation.init?.();
        const progress = this.elements.get(hero.progress.id);
        for (const part of [observation.stateNote, observation.content]) {
          if (part && progress && part.parentNode === observation) observation.insertBefore(part, progress);
        }
      }
    }
    for (const rail of this.rails) {
      if (rail.applied || !this.elements.get(rail.handle.model.choices[0]?.input.id ?? '')) continue;
      rail.applied = true;
      this.checkRail(rail.handle.model, rail.value());
    }
  }

  private maps(): MapSelect[] {
    const out: MapSelect[] = [];
    for (const section of this.screen.sections) {
      if ('map' in section && section.map?.kind === 'select') out.push(section.map);
    }
    return out;
  }

  private applySelect(map: MapSelect): void {
    const select = this.elements.get(map.face.id) as HTMLSelectElement | undefined;
    if (select && select.value !== map.value) select.value = map.value;
  }

  private element(target: Face | null | undefined): HTMLElement | null {
    if (!target) return null;
    if (this.painted !== changes.count) this.paint();
    return ((this.elements.get(target.id) ?? this.retired.get(target.id)?.deref()) as HTMLElement | undefined) ?? null;
  }

  // A drawn element the caller knows exists (a named part of the current build).
  private drawn(target: Face): HTMLElement {
    const node = this.element(target);
    if (!node) throw Error('robot_panel_element_missing');
    return node;
  }

  private faceOf(node: Element | null | undefined): Face | undefined {
    if (!node) return undefined;
    const id = this.ids.get(node);
    return id ? this.faceIndex.get(id) : undefined;
  }

  private all(selector: string, scope: ParentNode = this.content): Element[] {
    if (this.painted !== changes.count) this.paint();
    return [...scope.querySelectorAll(selector)];
  }

  private listen(target: Face, type: string, listener: EventListener): void {
    const node = this.painted === changes.count ? this.elements.get(target.id) : undefined;
    if (node) {
      node.addEventListener(type, listener);
      return;
    }
    const list = this.pending.get(target.id) ?? [];
    list.push([type, listener]);
    this.pending.set(target.id, list);
  }

  // ----- named parts (the drawn elements) -----

  get observation(): VacuumWidget | null {
    // (the hero's pv-vacuum-widget: the library component, with its own data and init)
    return this.element(this.screen.hero?.observation);
  }
  get heroEyebrow(): HTMLElement | null {
    return this.element(this.screen.hero?.eyebrow);
  }
  get robotProgress(): HTMLElement | null {
    return this.element(this.screen.hero?.progress);
  }
  get robotProgressLabel(): HTMLElement | null {
    return this.element(this.screen.hero?.progressLabel);
  }
  get robotProgressMeter(): HTMLProgressElement | null {
    const hero = this.screen.hero;
    if (!hero) return null;
    this.element(hero.progress);
    return (this.elements.get(`${hero.progress.id}-meter`) as HTMLProgressElement | undefined) ?? null;
  }
  get transportControls(): HTMLElement | null {
    const hero = this.screen.hero;
    if (!hero) return null;
    this.element(hero.observation);
    return (this.elements.get(`${hero.observation.id}-transport`) as HTMLElement | undefined) ?? null;
  }
  get settingsContext(): HTMLElement | null {
    return this.element(this.screen.hero?.settingsContext);
  }
  get confirmation(): HTMLDialogElement | null {
    return (this.element(this.screen.dialog?.face) as HTMLDialogElement | null);
  }
  get cleaningSubmit(): HTMLButtonElement | null {
    return (this.element(this.faces.submit) as HTMLButtonElement | null);
  }
  get cleaningForm(): HTMLFormElement | null {
    return (this.element(this.faces.form) as HTMLFormElement | null);
  }
  get availabilityNote(): HTMLElement | null {
    return this.element(this.faces.availability);
  }
  get currentMap(): HTMLElement | null {
    return this.element(this.faces.currentMap);
  }
  get currentRooms(): HTMLElement | null {
    return this.element(this.faces.currentRooms?.list);
  }
  get currentRoomsUnknown(): HTMLElement | null {
    return this.element(this.faces.currentRooms?.unknown);
  }
  get repeatStatus(): HTMLElement | null {
    return this.element(this.faces.repeatStatus);
  }
  get cleaningOptions(): HTMLElement | null {
    return this.element(this.faces.cleaningOptions?.face);
  }
  get cleaningTypeOptions(): HTMLElement | null {
    return this.element(this.faces.cleaningTypeOptions?.face);
  }

  // ----- data -----

  // Write-only, as before: hosts and tests read the current value from `value`.
  set data(value: PanelValue) {
    this.run(() => {
      this.receive(value);
    });
  }

  private receive(value: PanelValue): void {
    const before = this.value;
    const previous = before?.task,
      sameDevice = before?.device?.id === value.device?.id,
      sameContext =
        sameDevice &&
        !value.task?.historyDraft &&
        !value.selectedAreaId &&
        previous?.bootId === value.task?.bootId &&
        previous?.roomId === value.task?.roomId &&
        previous?.mapName === value.task?.mapName &&
        before?.localOnly === value.localOnly,
      samePresentation = sameContext && before?.device?.status === value.device?.status,
      draft = sameContext && this.cleaningDirty ? this.readCleaningDraft?.() : null,
      expanded = samePresentation ? {cleaning: this.optionsOpen()} : null,
      retained = before?.task,
      sameTask =
        sameDevice &&
        before?.selectedAreaId === value.selectedAreaId &&
        before?.device?.status === value.device?.status &&
        activeJob(before?.device) === activeJob(value.device) &&
        !!retained &&
        !!value.task &&
        sameTaskContent(retained, value.task) &&
        before.localOnly === value.localOnly;
    const oldScope = before?.presentationScope,
      newScope = value.presentationScope;
    const samePresentationScope =
      !!oldScope &&
      !!newScope &&
      !!oldScope.bootId &&
      !!oldScope.roomId &&
      !!oldScope.deviceId &&
      oldScope.bootId === newScope.bootId &&
      oldScope.roomId === newScope.roomId &&
      oldScope.deviceId === newScope.deviceId &&
      oldScope.deviceId === value.device?.id &&
      !!oldScope.transport &&
      oldScope.transport === newScope.transport &&
      Number.isSafeInteger(oldScope.generation) &&
      oldScope.generation === newScope.generation;
    const sameTaskScope =
      !oldScope &&
      !newScope &&
      !!previous?.bootId &&
      previous.bootId === value.task?.bootId &&
      previous.roomId === value.task.roomId;
    const sameConnectedRobot = (
      sameDevice &&
      before?.localOnly === value.localOnly &&
      before?.connected !== false &&
      value.connected !== false
    );
    const sameRobotScope = (
      sameConnectedRobot &&
      (samePresentationScope || sameTaskScope) &&
      !before?.device?.stale &&
      !value.device?.stale
    );
    const dialog = this.confirmation,
      directConfirmation =
        dialog?.open && this.screen.dialog ? attr(this.screen.dialog.face, 'data-direct-action') : null;
    const keepDirectConfirmation = !!(
      directConfirmation &&
      sameConnectedRobot &&
      samePresentationScope &&
      before.device?.status === value.device?.status &&
      activeJob(before.device) === activeJob(value.device) &&
      (!before.device?.stale || (directConfirmation === 'return' && before.directReadGap === true)) &&
      directConfirmationCurrent(directConfirmation, value)
    );
    if (directConfirmation && !keepDirectConfirmation) dialog?.close();
    const base = this.faces.base,
      baseTrigger = this.baseDisclosure?.trigger;
    const baseFocused = !!(sameRobotScope && baseTrigger && globalThis.document.activeElement === baseTrigger);
    const baseExpanded = (
      sameRobotScope && (base ? attr(base.trigger, 'aria-expanded') === 'true' : this.baseExpanded)
    );
    this.baseExpanded = baseExpanded;
    const map =
      sameContext &&
      
      before?.device?.status === value.device?.status &&
      activeJob(before?.device) === activeJob(value.device) &&
      before?.localOnly === value.localOnly
        ? rebindMap(retained, value.task)
        : null;
    let rebound = false;
    const localDraft = this.cleaningDirty ? this.readCleaningDraft?.() : null,
      restored = value.task?.draft,
      draftSafe =
        !this.cleaningDirty ||
        (!!localDraft &&
          restored?.status === 'restored' &&
          restored.optionId === map?.get(this.cleaningOptionId ?? '') &&
          JSON.stringify(restored.areaIds) === JSON.stringify(localDraft.areaIds.map(id => map?.get(id))) &&
          restored.repeat === localDraft.repeat &&
          JSON.stringify(restored.settingChoices) ===
            JSON.stringify(
              (localDraft.settingChoices ?? []).map(row => ({
                settingId: map?.get(row.settingId),
                choiceId: map?.get(row.choiceId),
              })),
            ));
    if (previous && value.task && previous.taskId !== value.task.taskId) {
      this.renewalDiagnostic = sameTask
        ? 'robot_rebind_same'
        : // (a same context is the same device and the same local/live kind)
          !sameContext ||
            before.device?.status !== value.device?.status ||
            activeJob(before.device) !== activeJob(value.device)
          ? 'robot_rebind_context'
          : value.task.rebind?.status === 'not_restored'
            ? 'robot_rebind_denied'
            : !value.task.rebind
              ? 'robot_rebind_absent'
              : !map
                ? 'robot_rebind_invalid'
                : !draftSafe
                  ? 'robot_rebind_draft'
                  : this.confirmation?.open
                    ? 'robot_rebind_dialog'
                    : 'robot_rebind_restored';
    } else this.renewalDiagnostic = null;
    if (map && draftSafe && !this.confirmation?.open && retained) {
      this.rebind(map);
      mutateOffer(retained.options, map);
      rebound = true;
    }
    this.value =
      (sameTask || rebound) && retained && value.task
        ? {...value, task: {...value.task, options: retained.options}}
        : value;
    if (value.task?.draft?.status === 'not_restored') this.draftFeedback = NOT_RESTORED;
    else if (
      value.task?.draft?.status === 'restored' ||
      !sameDevice ||
      previous?.bootId !== value.task?.bootId ||
      previous?.roomId !== value.task?.roomId ||
      (value.task && !value.task.draft)
    )
      this.draftFeedback = null;
    if (sameTask || rebound) {
      this.syncDirectTransport();
      this.updateObservation();
      this.updateSettingValues();
      this.refreshCleaningSummary?.();
      this.syncDisabled();
      return;
    }
    // A fresh offer may restore the active draft without attesting an in-place
    // rebind. Preserve only same-owner presentation alternatives; remap their
    // labels to the new form's offered IDs after the active draft is restored.
    const modeDrafts = sameRobotScope && draft ? this.readModeDrafts?.() : null;
    this.build(keepDirectConfirmation);
    const activeDraft =
      value.task?.draft?.status === 'restored' ? value.task.draft : !value.task?.draft ? draft : null;
    if (activeDraft && this.applyCleaningDraft?.(activeDraft)) {
      this.cleaningDirty = true;
      if (modeDrafts && (!modeDrafts.ok || modeDrafts.items.length)) this.applyModeDrafts?.(modeDrafts);
    }
    if (expanded) this.setOptionsOpen(expanded.cleaning);
    if (sameRobotScope && this.baseDisclosure) {
      this.baseDisclosure.setExpanded(baseExpanded);
      const trigger = this.baseDisclosure.trigger;
      const active = globalThis.document.activeElement;
      if (
        baseFocused &&
        !this.faces.base?.trigger.disabled &&
        (active === baseTrigger || active === globalThis.document.body)
      )
        trigger.focus({preventScroll: true});
    }
  }

  // The old panel read and restored `open` on its cleaning options section (a plain section: always false).
  private optionsOpen(): boolean {
    const node = this.cleaningOptions;
    return !!node && Reflect.get(node, 'open') === true;
  }
  private setOptionsOpen(open: boolean): void {
    const node = this.cleaningOptions;
    if (node) Reflect.set(node, 'open', open);
  }

  // An attested renewal: every control keeps its element and takes the new offer's identifiers.
  private rebind(map: Map<string, string>): void {
    this.rebindCleaningDrafts?.(map);
    for (const control of this.startSettingControls) {
      if (control.selected !== null && map.has(control.selected)) control.selected = map.get(control.selected) ?? null;
    }
    for (const node of this.all('button,input,option,select')) {
      const target = this.faceOf(node);
      if (!target) continue;
      for (const key of ['data-control-option-id', 'data-setting-id']) {
        const current = attr(target, key);
        if (current !== null && map.has(current)) setAttr(target, key, map.get(current) ?? '');
      }
      if (node instanceof HTMLSelectElement || (node instanceof HTMLInputElement && node.type !== 'radio')) {
        if (map.has(node.value)) node.value = map.get(node.value) ?? '';
      } else {
        const current = attr(target, 'value');
        if (current !== null && map.has(current)) setAttr(target, 'value', map.get(current) ?? '');
      }
    }
    if (this.cleaningOptionId !== null && map.has(this.cleaningOptionId))
      this.cleaningOptionId = map.get(this.cleaningOptionId) ?? null;
    for (const control of this.indirectChoiceControls) {
      if (control.choiceId !== null && map.has(control.choiceId)) control.choiceId = map.get(control.choiceId) ?? null;
      if (control.choiceId !== null) control.rail?.setValue(control.choiceId);
    }
  }

  // Write-only, as before (`_disabled` holds it).
  set disabled(value: boolean) {
    this.run(() => {
      this._disabled = value;
      this.syncDisabled();
    });
  }

  syncDisabled(): void {
    this.run(() => {
      this.syncDisabledNow();
    });
  }

  private syncDisabledNow(): void {
    const value = this.value ?? {},
      options = value.task?.options ?? [],
      pending = value.device?.pending;
    const actionOptions = pending?.action ? options.filter(option => option.action === pending.action) : [];
    const pendingId =
      value.pendingOptionId || pending?.optionId || (actionOptions.length === 1 ? actionOptions[0]?.id : null);
    const knownPending = !!pending || !!value.pendingOptionId;
    // While the owner fetches a fresh offer (loading), an expired one keeps the controls live; taps wait for it.
    const expired = expiredOffer(value.task) && value.loading !== true;
    const unavailable =
      this._disabled || value.connected === false || knownPending || !!value.device?.stale || expired;
    // While only a robot command is pending, Start and its local draft stay live: Start shows busy, a
    // changed room or setting is kept for the next Start, and a second Start gets a message (S2).
    const draftHeld =
      knownPending &&
      (!this._disabled || ownRobotPending(value)) &&
      value.readOnly !== true &&
      value.connected !== false &&
      !value.device?.stale &&
      !expired;
    const baseTrigger = this.baseDisclosure?.trigger,
      form = this.cleaningForm;
    for (const el of this.all('button,input,select')) {
      if (el === baseTrigger) continue;
      const target = this.faceOf(el);
      if (!target) continue;
      const draft = draftHeld && (target === this.faces.submit || !!form?.contains(el));
      const actionId = attr(target, 'data-action-id');
      const disabled = (
        (!attr(target, 'data-local-draft') && !draft && unavailable) ||
        attr(target, 'data-unready') === 'true' ||
        (actionId === 'pause' && value.device?.status !== 'cleaning') ||
        (actionId === 'resume' && value.device?.status !== 'paused')
      );
      this.setControlDisabled(el, target, disabled);
      const radio = attr(target, 'type') === 'radio';
      if (el.tagName !== 'BUTTON' && !radio) continue;
      const option = options.find(row => row.id === pendingId),
        sameOption = !!option && attr(target, 'data-control-option-id') === pendingId,
        pendingChoice = value.pendingChoiceId ?? pending?.choiceId,
        pendingValue = value.pendingValue ?? pending?.value,
        own = attr(target, 'value'),
        exactTarget =
          !radio ||
          (option?.argsSchema.kind === 'choice' &&
            typeof pendingChoice === 'string' &&
            (option.argsSchema.choices ?? []).some(choice => choice.id === pendingChoice) &&
            own === pendingChoice) ||
          (option?.argsSchema.kind === 'number' &&
            Number.isFinite(pendingValue) &&
            own === String(pendingValue)),
        busy = (knownPending && sameOption && exactTarget && value.connected !== false && !value.device?.stale);
      setAttr(target, 'aria-busy', String(busy));
      if (radio) {
        // A chip never shows command feedback: whatever wrote it there (an older host), it is removed.
        const label = el.parentElement;
        if (label?.dataset.kit === 'chip') {
          if (label.getAttribute('data-feedback') === 'progress') label.removeAttribute('data-feedback');
          if (label.getAttribute('aria-busy') !== null) label.removeAttribute('aria-busy');
        }
      } else if (attr(target, 'data-control-option-id') !== null) {
        const family = attr(target, 'data-kit') ?? '';
        if (['button', 'chip', 'tile', 'toggle'].includes(family))
          kit(target, family, {feedback: 'progress', loading: busy});
      }
    }
    for (const el of this.all('[data-direct-robot=true]')) {
      const target = this.faceOf(el);
      if (!target) continue;
      const action = attr(target, 'data-action-id') ?? '',
        blocked =
          value.directBlocked === true ||
          value.connected === false ||
          !!value.device?.stale ||
          !value.directActions?.includes(action);
      this.setControlDisabled(el, target, blocked);
      const busy = !blocked && value.directPendingAction === action;
      setAttr(target, 'aria-busy', String(busy));
      kit(target, 'button', {
        identity: 'robot',
        variant: action === 'stop' ? 'destructive' : 'secondary',
        feedback: 'progress',
        loading: busy,
      });
    }
    // Base is a local disclosure. Its command buttons still follow the current offer.
    const base = this.faces.base;
    const directReturn = base
      ? this.faceOf(this.element(base.panel)?.querySelector('[data-direct-robot=true][data-action-id=return]'))
      : undefined;
    const baseBlocked = value.connected === false || knownPending || !!value.device?.stale || value.readOnly === true;
    if (baseBlocked) this.baseExpanded = false;
    this.baseDisclosure?.setDisabled(baseBlocked && (!directReturn || directReturn.disabled));
    for (const field of this.all('fieldset')) {
      const target = this.faceOf(field);
      if (!target || !hasClass(target, 'robot-level-setting')) continue;
      const busy = [...field.querySelectorAll('input')].some(input => {
        const own = this.faceOf(input);
        return !!own && attr(own, 'aria-busy') === 'true';
      });
      setAttr(target, 'aria-busy', String(busy));
    }
    const hero = this.screen.hero;
    if (!hero) return;
    const commands = hero.transport.filter(item => item.kind !== 'base'),
      primaryAction =
        value.device?.status === 'cleaning' ? 'pause' : value.device?.status === 'paused' ? 'resume' : null,
      wanted =
        commands.find(item => {
          const target = this.itemFace(item);
          return !!target && attr(target, 'data-action-id') === primaryAction;
        }) ?? commands.find(item => item.kind === 'submit');
    let primary: TransportItem | null = null;
    for (const item of commands) {
      const target = this.itemFace(item);
      if (!target) continue;
      const selected = item === wanted && !primary;
      if (selected) primary = item;
      const classes = target.className.split(/\s+/).filter(name => name !== 'pv-primary');
      if (selected) classes.push('pv-primary');
      setClass(target, classes.join(' '));
      const actionId = attr(target, 'data-action-id') ?? '';
      const contextAction = ['pause', 'resume'].includes(actionId);
      if (contextAction) setAttr(target, 'data-kit-action-role', 'context');
      kit(target, 'button', {
        identity: 'robot',
        variant: actionId === 'stop' ? 'destructive' : selected && !contextAction ? 'primary' : 'secondary',
      });
    }
    if (primary && hero.transport[0] !== primary) {
      hero.transport = [primary, ...hero.transport.filter(item => item !== primary)];
      touch();
    }
  }

  // The live host disables every control in its detail natively while it sends (live-control-view.js); as before,
  // the panel's own state wins again at its next sync, so the element is corrected too, not only its face.
  private setControlDisabled(el: Element, target: Face, disabled: boolean): void {
    setDisabled(target, disabled);
    const control = el as HTMLButtonElement;
    if (control.disabled !== disabled) control.disabled = disabled;
  }

  private itemFace(item: TransportItem): Face | null {
    if (item.kind === 'submit') return this.screen.submit?.face ?? null;
    if (item.kind === 'base') return null;
    return this.screen.actions[item.key]?.face ?? null;
  }

  // The live host marks the command buttons of its pending option busy (and every other one not busy).
  showOptionBusy(optionId: string | null): void {
    this.run(() => {
      for (const el of this.all('button')) {
        const target = this.faceOf(el);
        if (!target) continue;
        const own = attr(target, 'data-control-option-id'),
          family = attr(target, 'data-kit') ?? '';
        const command = own && attr(target, 'data-direct-robot') !== 'true';
        if (command && ['button', 'chip', 'tile', 'toggle'].includes(family))
          kit(target, family, {feedback: 'progress', loading: optionId !== null && own === optionId});
      }
    });
  }

  emit(name: string, detail?: unknown): void {
    if (this._disabled) return;
    this.dispatchEvent(new CustomEvent(name, {detail, bubbles: true, composed: true}));
  }

  validHistoryDraft(value: unknown): Record<string, unknown> | null {
    const task = this.value?.task,
      starts = task?.options.filter(o => o.action === 'start' && o.argsSchema.kind === 'cleaning') ?? [];
    const draft = value as {source?: unknown; optionId?: unknown; areaIds?: unknown; repeat?: unknown} | null;
    if (
      task?.domain !== 'vacuum' ||
      task.revision !== 1 ||
      !Number.isFinite(task.expiresAt) ||
      (task.expiresAt ?? 0) * 1000 <= Date.now() ||
      !draft ||
      typeof draft !== 'object' ||
      Array.isArray(draft) ||
      Object.keys(draft).sort().join(',') !== 'areaIds,optionId,repeat,source' ||
      draft.source !== 'accepted_start_history' ||
      starts.length !== 1 ||
      draft.optionId !== starts[0]?.id ||
      task.options.filter(o => o.action === 'reuse' && o.argsSchema.kind === 'none').length !== 1 ||
      !Array.isArray(draft.areaIds) ||
      draft.areaIds.length > 32
    )
      return null;
    try {
      return {
        source: draft.source,
        optionId: draft.optionId,
        ...controlArgs(task, draft.optionId as string, {areaIds: draft.areaIds, repeat: draft.repeat}),
      };
    } catch {
      return null;
    }
  }

  validSuggestion(value: unknown): Suggestion | null {
    const task = this.value?.task,
      row = value as Suggestion | null | undefined;
    if (
      !row ||
      !task ||
      row.optionId !== this.cleaningOptionId ||
      Object.keys(row).sort().join(',') !==
        'areaIds,basis,bootId,expiresAt,optionId,recipeId,repeat,revision,roomId,schema,source,taskId' ||
      row.schema !== 'podview.robot-suggestion.v1' ||
      row.bootId !== task.bootId ||
      row.roomId !== task.roomId ||
      row.taskId !== task.taskId ||
      row.revision !== 1 ||
      row.revision !== task.revision ||
      row.source !== 'ai_recipe_selection' ||
      row.basis !== 'recent_choices' ||
      !/^[a-f0-9]{32}$/.test(row.recipeId) ||
      !/^[a-f0-9]{24}$/.test(row.optionId) ||
      row.expiresAt !== task.expiresAt ||
      !Number.isFinite(row.expiresAt) ||
      row.expiresAt * 1000 <= Date.now()
    )
      return null;
    const option = task.options.find(
        item => item.id === row.optionId && item.action === 'start' && item.argsSchema.kind === 'cleaning',
      ),
      areas = row.areaIds as unknown;
    const schema = option?.argsSchema;
    if (
      !schema ||
      !Array.isArray(areas) ||
      !areas.length ||
      areas.length > 64 ||
      new Set(areas).size !== areas.length ||
      areas.some(
        id =>
          typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id) || !(schema.areas ?? []).some(area => area.id === id),
      ) ||
      !Number.isInteger(row.repeat) ||
      row.repeat < (schema.repeat?.min ?? 0) ||
      row.repeat > (schema.repeat?.max ?? 0)
    )
      return null;
    return {...row, areaIds: [...(areas as string[])]};
  }

  suggest(value: unknown): boolean {
    return this.run(() => {
      const caption = this.proposalCaption,
        zone = this.proposalZone;
      if (!caption || !this.isConnected || this.historyApplied) return false;
      const valid = !this._disabled && this.validSuggestion(value);
      if (!valid) {
        this.currentSuggestion = null;
        this.proposalSignature = null;
        caption.hidden = true;
        if (zone) zone.hidden = true;
        return false;
      }
      if (this.cleaningDirty) return false;
      const signature = JSON.stringify(valid);
      if (signature === this.proposalSignature) return true;
      this.proposalSignature = signature;
      this.currentSuggestion = valid;
      this.applyCleaningDraft?.(valid);
      this.cleaningDirty = false;
      this.cleaningApplied = true;
      caption.textContent = 'Seneste rumvalg';
      caption.hidden = true;
      if (zone) zone.hidden = true;
      return true;
    });
  }

  observed(device: RobotDevice | null | undefined, context: PanelValue = {}): void {
    this.run(() => {
      const before = this.value ?? {},
        next: PanelValue = {...before, ...context, device},
        dialog = this.confirmation,
        direct = dialog?.open && this.screen.dialog ? attr(this.screen.dialog.face, 'data-direct-action') : null;
      if (
        direct &&
        (device?.id !== before.device?.id ||
          device?.status !== before.device?.status ||
          activeJob(device) !== activeJob(before.device) ||
          !directConfirmationCurrent(direct, next))
      )
        dialog?.close();
      this.value = next;
      this.syncDirectTransport();
      this.updateObservation();
      this.updateSettingValues();
      this.refreshCleaningSummary?.();
      this.syncDisabled();
    });
  }

  updateObservation(): void {
    this.run(() => {
      this.updateObservationNow();
    });
  }

  private updateObservationNow(): void {
    const value = this.value,
      d = value?.device,
      experience = robotExperience(d ?? {}),
      unknownFault = ['fault', 'error'].includes(d?.status ?? '') && !experience.issues.length;
    const ready = String(!!robotControlGroups(value?.task).cleaning && !activeJob(d));
    if (this.dataset.cleaningReady !== ready) this.dataset.cleaningReady = ready;
    // Fejl 15 (13 Nov): once the robot reports a job, its Pause/Afslut controls replace the start
    // form in the same update; the form is only hidden, so an edited draft survives (S2).
    const job = activeJob(d);
    if (this.faces.submit) setHidden(this.faces.submit, job);
    const note = this.faces.availability;
    if (note) {
      const loading = value?.loading === true;
      setText(
        note,
        unknownFault
          ? 'Åbn Roborock-appen for at se fejlen og få hjælp.'
          : experience.issues.length
            ? ''
            : loading
              ? 'Henter aktuel betjening…'
              : !value?.task
                ? value?.readOnly !== false
                  ? 'Kun status er tilgængelig.'
                  : ''
                : this.mapControl && value.connected !== false
                  ? ''
                  : 'Du kan ikke ændre rengøringen her lige nu.',
      );
      setHidden(note, !note.text);
    }
    if (this.faces.currentMap) {
      const map = value?.currentSetup?.mapName || value?.task?.mapName,
        known = typeof map === 'string' && map.trim().length > 0 && map.length <= 160;
      setText(this.faces.currentMap, known ? map : '');
      setHidden(this.faces.currentMap, !known);
    }
    const rooms = this.faces.currentRooms;
    if (rooms) {
      const room = robotRoom(d ?? {});
      setText(rooms.unknown, room ? `Rengør nu: ${room}` : 'Valgte rum er ikke oplyst');
    }
    this.updateCurrentRooms();
    if (this.repeatReadOnlyRail) {
      const count = value?.currentSetup?.repeat;
      this.repeatReadOnlyRail.setValue(Number.isInteger(count) ? String(count) : null);
    }
    if (this.faces.repeatStatus) {
      const count = value?.currentSetup?.repeat;
      setText(
        this.faces.repeatStatus,
        typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 3
          ? `${String(count)} ${count === 1 ? 'gang' : 'gange'}`
          : 'Aktuelt antal ikke oplyst',
      );
    }
    const hero = this.screen.hero;
    if (!hero) return;
    setAttr(hero.observation, 'data-setup-pending', String(value?.loading === true && !value.task));
    const now = Date.now() / 1000,
      telemetry = d?.telemetry,
      progress =
        d?.status === 'cleaning' &&
        !d.stale &&
        value?.connected !== false &&
        telemetry?.status === 'observed' &&
        Array.isArray(telemetry.items)
          ? telemetry.items.find(row => row.key === 'clean_percent')
          : null,
      percent = progress?.value,
      updatedAt = progress?.updatedAt,
      known =
        progress?.stale === false &&
        progress.unit === '%' &&
        typeof updatedAt === 'number' &&
        Number.isFinite(updatedAt) &&
        updatedAt >= 0 &&
        updatedAt <= now + 1 &&
        now - updatedAt <= 300 &&
        typeof percent === 'number' &&
        Number.isFinite(percent) &&
        percent >= 0 &&
        percent <= 100;
    setHidden(hero.progress, !known);
    if (known) {
      if (hero.meter !== percent) {
        hero.meter = percent;
        touch();
      }
      setText(hero.progressLabel, `${percent.toLocaleString('da-DK', {maximumFractionDigits: 1})} % færdig`);
    }
    const detail = robotDetailMetadata(d);
    setAttr(hero.observation, 'data-kit-density', 'compact');
    const statusText = deviceLabel({...d, kind: 'vacuum', live: d?.live !== false}),
      offline = value?.connected === false || !!d?.stale;
    const observation = this.observation;
    if (observation)
      observation.data = {
        title: 'Robotstøvsuger',
        resourceStatus: d?.status || 'unknown',
        state: d?.pending ? 'pending' : 'ready',
        quietStatus: true,
        connected: value?.connected,
        text: offline && !/^Ikke opdateret\b/i.test(statusText) ? `Ikke opdateret · ${statusText}` : statusText,
        detail,
        actions: [],
      };
    // The eyebrow over the title (lærred »A-Robot«: »Ved basen«, the running mode, »Kør til basen«,
    // »Robotfejl«).
    const facts = robotFacts(d ?? {});
    const mode = facts.details.find(row => row.label === 'Rengøringstilstand' && !row.stale)?.value;
    const status = d?.status ?? '';
    const eyebrow = ['docked', 'charging'].includes(status)
      ? 'Ved basen'
      : ['docking', 'returning'].includes(status)
        ? 'Kør til basen'
        : ['fault', 'error'].includes(status)
          ? 'Robotfejl'
          : ['cleaning', 'paused'].includes(status) && mode
            ? mode
            : 'Robotstøvsuger';
    setText(hero.eyebrow, eyebrow);
    const pendingStates = ['pending', 'preparing', 'sending'];
    const control = value?.controlFeedback;
    const feedback =
        control?.text && !pendingStates.includes(control.state ?? '')
          ? control
          : this.draftFeedback
            ? {text: this.draftFeedback, state: 'unknown'}
            : null,
      visible =
        typeof feedback?.text === 'string' &&
        feedback.text.length > 0 &&
        feedback.text.length <= 240 &&
        !pendingStates.includes(feedback.state ?? ''),
      state = visible && ['accepted', 'error', 'unknown'].includes(feedback.state ?? '') ? feedback.state : 'ready',
      text =
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
    setAttr(hero.settingsContext, 'data-feedback-state', state ?? 'ready');
    setText(hero.settingsContext, text);
  }

  private renderTransportOptions(options: RobotOption[], device: RobotDevice | null | undefined): void {
    const hero = this.screen.hero;
    if (!hero || !options.length) return;
    const items: TransportItem[] = [],
      primary = options.find(
        option =>
          option.action ===
          (device?.status === 'cleaning' ? 'pause' : device?.status === 'paused' ? 'resume' : null),
      );
    for (const option of [...options].sort((a, b) => Number(b === primary) - Number(a === primary))) {
      const stop = option.action === 'stop';
      const target = made(
        'button',
        stop ? 'Afslut rengøring' : option.label,
        stop ? 'pv-button pv-ghost stop' : option === primary ? 'pv-button pv-primary' : 'pv-button',
      );
      setAttr(target, 'type', 'button');
      setAttr(target, 'data-kit-shape', 'pill');
      setAttr(target, 'data-action-id', option.action);
      setAttr(target, 'data-control-option-id', option.id);
      if (option.direct) setAttr(target, 'data-direct-robot', 'true');
      const src = `assets/icons/${TRANSPORT_ICONS[option.action] ?? ''}.svg`;
      this.screen.actions[target.id] = {
        face: target,
        icon: stop ? {tag: 'span', src} : {tag: 'img', src, variant: 'default'},
        label: target.text,
      };
      this.listen(target, 'click', () => {
        this.run(() => {
          if (['stop', 'return'].includes(option.action)) this.confirmAction(option, this.element(target));
          else this.action(option);
        });
      });
      items.push({kind: 'action', key: target.id});
    }
    // A re-rendered offer takes the same place as before: in front of Base, never after it (S3).
    if (hero.transport.some(item => item.kind === 'base')) hero.transport = [...items, ...hero.transport];
    else hero.transport = [...hero.transport, ...items];
    touch();
  }

  private syncDirectTransport(): void {
    const hero = this.screen.hero;
    if (!hero || !Array.isArray(this.value?.directActions)) return;
    const actions = this.value.directActions,
      signature = JSON.stringify([actions, this.value.device?.status]);
    if (signature === this.directTransportSignature) return;
    this.directTransportSignature = signature;
    const direct = (key: string) => {
      const button = this.screen.actions[key];
      return !!button && attr(button.face, 'data-direct-robot') === 'true';
    };
    hero.transport = hero.transport.filter(item => item.kind !== 'action' || !direct(item.key));
    if (this.screen.base) this.screen.base.items = this.screen.base.items.filter(key => !direct(key));
    touch();
    const labels: Record<string, string> = {
      pause: 'Pause',
      resume: 'Fortsæt',
      stop: 'Afslut rengøring',
      return: 'Kør til basen',
    };
    this.renderTransportOptions(
      actions.map(action => ({
        id: 'direct:' + action,
        action,
        label: labels[action] ?? '',
        direct: true,
        argsSchema: {kind: 'none'},
      })),
      this.value.device,
    );
    if (this.screen.dialog) this.compactActiveActions();
  }

  action(option: RobotOption | null | undefined, args: Record<string, unknown> = {}): void {
    const value = this.value ?? {},
      task = value.task,
      device = value.device;
    if (option?.direct) {
      if (value.connected === false || device?.stale || !value.directActions?.includes(option.action)) return;
      this.dispatchEvent(
        new CustomEvent('robot-direct-action', {detail: {action: option.action}, bubbles: true, composed: true}),
      );
      return;
    }
    if (option?.action === 'start' && (value.pendingOptionId || device?.pending)) {
      // A second Start is not queued behind a running command; the user gets a concrete answer (S2).
      this.draftFeedback = 'Robotten er i gang med den forrige kommando · dine valg gemmes til næste start.';
      this.updateObservation();
      return;
    }
    // A Start on an offer that expired unnoticed is still the user's action; the owner decides what happens to it.
    if (
      option?.action === 'start' &&
      task?.options.includes(option) &&
      expiredOffer(task) &&
      value.connected !== false &&
      !value.pendingOptionId &&
      !device?.pending &&
      !device?.stale
    ) {
      this.dispatchEvent(
        new CustomEvent('robot-control-expired-start', {
          detail: {optionId: option.id},
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    if (
      !option ||
      !task?.options.includes(option) ||
      (expiredOffer(task) && value.loading !== true) ||
      value.connected === false ||
      value.pendingOptionId ||
      device?.pending ||
      device?.stale ||
      (option.action === 'pause' && device?.status !== 'cleaning') ||
      (option.action === 'resume' && device?.status !== 'paused')
    )
      return;
    this.emit('robot-control-action', {optionId: option.id, args});
  }

  disconnectedCallback(): void {
    this.stickyObserver?.disconnect();
    this.stickyObserver = null;
    const dialog = this.confirmation;
    if (dialog?.open) dialog.close();
    this.baseExpanded = false;
    this.run(() => {
      this.baseDisclosure?.setExpanded(false);
    });
  }

  private build(keepDirectConfirmation = false): void {
    const screen = this.screen;
    const dialog = this.confirmation;
    if (!keepDirectConfirmation) {
      if (dialog?.open) dialog.close();
      this.replaceChildren(this.content);
    }
    this.baseDisclosure?.setExpanded(false);
    const {task, device} = this.value ?? {},
      groups = robotControlGroups(task);
    for (const [id, ref] of this.retired) if (!ref.deref()) this.retired.delete(id);
    this.screen = {
      ...emptyScreen(),
      build: String(++buildSerial),
      dialogFirst: keepDirectConfirmation,
      dialog: keepDirectConfirmation ? screen.dialog : null,
    };
    touch();
    this.faces = {
      submit: null,
      form: null,
      availability: null,
      currentMap: null,
      currentRooms: null,
      repeatStatus: null,
      cleaningOptions: null,
      cleaningTypeOptions: null,
      base: null,
    };
    this.rails = [];
    this.proposalButton = null;
    this.proposalCaption = null;
    this.proposalZone = null;
    this.proposalSignature = null;
    this.currentSuggestion = null;
    this.cleaningDirty = false;
    this.cleaningApplied = false;
    this.historyApplied = false;
    this.cleaningOptionId = null;
    this.readCleaningDraft = null;
    this.applyCleaningDraft = null;
    this.settingControls = [];
    this.startSettingControls = [];
    this.indirectChoiceControls = [];
    this.rebindCleaningDrafts = null;
    this.readModeDrafts = null;
    this.applyModeDrafts = null;
    this.cleaningOptionsSummary = null;
    this.refreshCleaningSummary = null;
    this.repeatReadOnlyRail = null;
    this.currentAreasSignature = null;
    this.mapControl = null;
    this.baseDisclosure = null;
    this.dataset.layout = 'compact';
    this.dataset.cleaningReady = String(!!groups.cleaning && !activeJob(device));
    // Reuse the canonical robot instrument; this adapter adds only admitted native controls.
    const observation = face('pv-hero');
    kit(observation, 'hero', {identity: 'robot'});
    setAttr(observation, 'data-detail-zone', 'hero');
    setAttr(observation, 'data-kit-tone', 'tinted');
    const progress = face('player-progress');
    progress.hidden = true;
    this.screen.hero = {
      observation,
      eyebrow: made('p', '', 'robot-hero-eyebrow'),
      progress,
      progressLabel: made('p', '', 'pv-meta'),
      meter: null,
      transport: [],
      settingsContext: made('p', '', 'pv-meta robot-settings-context'),
    };
    setAttr(this.screen.hero.settingsContext, 'role', 'status');
    this.updateObservationNow();
    this.directTransportSignature = null;
    if (!keepDirectConfirmation) {
      const target = face('robot-action-confirm');
      this.screen.dialog = {face: target, confirm: null};
      this.listen(target, 'close', () => {
        const node = this.elements.get(target.id) as HTMLDialogElement | undefined;
        if (node?.dataset.presentationClose === 'true') {
          delete node.dataset.presentationClose;
          return;
        }
        if (this.confirmationOpener?.isConnected) (this.confirmationOpener as HTMLElement).focus();
        this.confirmationOpener = null;
      });
      this.listen(target, 'cancel', event => {
        event.preventDefault();
        (this.elements.get(target.id) as HTMLDialogElement | undefined)?.close();
      });
    }
    if (Array.isArray(this.value?.directActions)) this.syncDirectTransport();
    else this.renderTransportOptions(groups.transport, device);
    const historyDraft = this.validHistoryDraft(task?.historyDraft);
    if (groups.cleaning && !activeJob(device)) this.buildCleaning(groups.cleaning, task?.mapName, historyDraft);
    else if (task && !activeJob(device) && (task.mapName || groups.settings.length)) {
      const zone = face('device-history robot-cleaning-zone');
      kit(zone, 'card', {identity: 'robot'});
      setAttr(zone, 'data-kit-layout', 'controls');
      setAttr(zone, 'data-detail-zone', 'controls');
      this.screen.sections.push({kind: 'empty-rooms', zone, map: this.buildMapSelector(task.mapName)});
    }
    const dailySettings = groups.settings.filter(
      option =>
        ((option.argsSchema.kind === 'choice' &&
          ['mode', 'suction', 'water', 'mop_mode', 'repeat'].includes(settingConcept(option))) ||
          (option.argsSchema.kind === 'number' && settingConcept(option) === 'repeat')) &&
        (!groups.cleaning?.argsSchema.settings?.length || activeJob(device)),
    );
    const sorted = [...dailySettings].sort((a, b) => settingOrder(a) - settingOrder(b));
    if (dailySettings.length && !groups.cleaning && !activeJob(device)) {
      const settings = face('robot-settings-zone');
      kit(settings, 'card', {identity: 'robot'});
      setAttr(settings, 'data-kit-layout', 'controls');
      setAttr(settings, 'data-detail-zone', 'controls');
      const typeOptions = this.group('div', 'robot-type-options');
      setAttr(typeOptions.face, 'role', 'group');
      setAttr(typeOptions.face, 'aria-label', 'Indstillinger for valgt type');
      const controls = this.group('div', 'robot-current-controls');
      for (const option of sorted)
        this.buildSetting(settingConcept(option) === 'mode' ? controls : typeOptions, option);
      controls.children.push(typeOptions);
      this.screen.sections.push({kind: 'settings-zone', face: settings, controls});
    } else if (dailySettings.length || activeJob(device)) {
      const active = activeJob(device),
        settings = face('device-history settings robot-current-settings'),
        controls = this.group('div', 'robot-current-controls'),
        typeOptions = this.group('div', 'robot-type-options');
      setAttr(typeOptions.face, 'role', 'group');
      setAttr(typeOptions.face, 'aria-label', 'Indstillinger for valgt type');
      setAttr(settings, 'data-detail-zone', 'controls');
      if (active) {
        kit(settings, 'card', {identity: 'robot'});
        setAttr(settings, 'data-kit-layout', 'controls');
        const card = face('robot-current-rooms');
        kit(card, 'card', {identity: 'robot'});
        setAttr(card, 'data-kit-layout', 'controls');
        setAttr(card, 'data-detail-zone', 'controls');
        const map = this.buildMapSelector(this.value?.currentSetup?.mapName || task?.mapName);
        const list = face('choices pv-tiles robot-current-room-list');
        setAttr(list, 'aria-label', 'Valgte rum');
        const unknown = made('p', 'Valgte rum er ikke oplyst', 'robot-current-rooms-unknown');
        kit(unknown, 'listrow', {identity: 'robot', variant: 'read-only'});
        const section: Section & {kind: 'current-rooms'} = {kind: 'current-rooms', card, map, list, rooms: [], unknown};
        this.faces.currentRooms = section;
        this.screen.sections.push(section);
      }
      // Without a job these rows are read-only and join the start form's options (an offer with daily settings
      // and no running job always has a start form here); during a job they form their own card.
      const options = this.faces.cleaningOptions,
        typed = this.faces.cleaningTypeOptions;
      for (const option of sorted) {
        const mode = settingConcept(option) === 'mode';
        const parent = active ? (mode ? controls : typeOptions) : mode ? options : typed;
        if (parent) this.buildSetting(parent, option, !active || mode);
      }
      if (active) controls.children.push(typeOptions);
      if (active && !dailySettings.some(option => settingConcept(option) === 'repeat'))
        this.buildRepeatStatus(typeOptions, device);
      if (!active && dailySettings.length && typed) {
        const note = made('p', 'De viste robotindstillinger kan ikke ændres i dette rengøringssetup.', 'pv-meta');
        typed.children.push({kind: 'note', face: note});
      }
      if (options && typed) {
        const repeat = this.findPart(options, part => part.kind === 'rail' && hasClass(part.rail.node, 'repeat'));
        if (repeat) this.movePart(repeat, typed);
        this.movePart(typed, options);
      }
      if (active) this.screen.sections.push({kind: 'current-settings', face: settings, controls});
    }
    if (groups.reuse && !historyDraft && !groups.cleaning && !activeJob(device)) {
      const reuse = groups.reuse;
      const button = made('button', 'Start denne rengøring', 'pv-button pv-primary start');
      setAttr(button, 'data-control-option-id', reuse.id);
      setAttr(button, 'type', 'button');
      this.screen.actions[button.id] = {
        face: button,
        icon: {tag: 'img', src: 'assets/icons/play-fill.svg'},
        label: button.text,
      };
      this.listen(button, 'click', () => {
        this.run(() => {
          this.action(reuse);
        });
      });
      this.screen.sections.push({kind: 'reuse', button: button.id});
    }
    if (
      !task ||
      (!groups.cleaning &&
        !groups.reuse &&
        !dailySettings.length &&
        !groups.transport.length &&
        !groups.dock.length)
    ) {
      const note = made('p', '', 'pv-meta empty');
      setAttr(note, 'role', 'status');
      this.faces.availability = note;
      this.screen.sections.push({kind: 'availability', face: note});
      this.updateObservationNow();
    }
    this.buildDock(groups.dock);
    this.compactActiveActions();
    this.updateObservationNow();
    this.updateSettingValues();
    if (keepDirectConfirmation && this.screen.dialog) {
      const action = attr(this.screen.dialog.face, 'data-direct-action');
      this.confirmationOpener =
        this.transportControls?.querySelector(`[data-direct-robot=true][data-action-id=${action ?? ''}]`) ?? null;
    }
    this.syncDisabledNow();
    this.buildStickyLine();
  }

  // The active repeat count: a read-only rail for an explicit local example with a known range, else a status row.
  private buildRepeatStatus(typeOptions: Part & {kind: 'group'}, device: RobotDevice | null | undefined): void {
    const range = this.value?.currentSetup?.repeatRange,
      count = this.value?.currentSetup?.repeat,
      min = range?.min,
      max = range?.max;
    const known =
      this.value?.localOnly === true &&
      device?.exampleOnly === true &&
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
    if (known) {
      const rail = this.createRail({
        id: `robot-repeat-observed-${String(++cleaningSerial)}`,
        label: 'Antal gange',
        choices: Array.from({length: max - min + 1}, (_, i) => ({
          value: String(min + i),
          label: `${String(min + i)}×`,
        })),
        value: String(count),
      });
      this.decorateLevel(rail, 'repeat');
      this.compactRepeat(rail);
      addClasses(rail.model.node, 'robot-repeat-status', 'robot-level-setting');
      for (const choice of rail.model.choices) {
        setAttr(choice.input, 'data-unready', 'true');
        setDisabled(choice.input, true);
      }
      this.repeatReadOnlyRail = rail;
      typeOptions.children.push({kind: 'rail', rail: rail.model});
      return;
    }
    const row = face('robot-repeat-status');
    kit(row, 'listrow', {identity: 'robot', variant: 'read-only'});
    const title = textRole(made('h3', 'Antal gange', 'pv-section-header'), 'field-label'),
      value = made('p', '', 'robot-repeat-value');
    this.faces.repeatStatus = value;
    typeOptions.children.push({kind: 'repeat-row', face: row, title, value});
  }

  private group(tag: 'div' | 'section', className: string): Part & {kind: 'group'} {
    return {kind: 'group', tag, face: face(className), children: []};
  }

  private findPart(root: Part & {kind: 'group'}, test: (part: Part) => boolean): Part | null {
    for (const child of root.children) {
      if (test(child)) return child;
      if (child.kind === 'group') {
        const found = this.findPart(child, test);
        if (found) return found;
      }
    }
    return null;
  }

  // The old append() of an already placed element: it leaves its parent and becomes the new parent's last child.
  private movePart(part: Part, parent: Part & {kind: 'group'}): void {
    const detach = (group: Part & {kind: 'group'}): void => {
      group.children = group.children.filter(child => child !== part);
      for (const child of group.children) if (child.kind === 'group') detach(child);
    };
    for (const section of this.screen.sections) {
      if (section.kind === 'cleaning') detach(section.options);
      else if (section.kind === 'settings-zone' || section.kind === 'current-settings') detach(section.controls);
    }
    const options = this.faces.cleaningOptions;
    if (options) detach(options);
    parent.children.push(part);
    touch();
  }

  // createKitChoiceGroup, variant level: native radios on kit Chips. Which radio is checked is the radio's own state.
  private createRail({
    id,
    label,
    choices,
    value,
    onChange,
    auxiliaryValues = [],
  }: {
    id: string;
    label: string;
    choices: {value: string; label: string}[];
    value: string | null | undefined;
    onChange?: (value: string) => void;
    auxiliaryValues?: string[];
  }): RailHandle {
    const node = face('pv-kit-choice-group', {'data-choice-variant': 'level'});
    const requested = new Set(auxiliaryValues.map(String)),
      auxiliary = new Set(choices.map(choice => choice.value).filter(item => requested.has(item)));
    const track = face('pv-kit-choice-options');
    const count = choices.filter(choice => !auxiliary.has(choice.value)).length;
    setAttr(track, 'data-choice-count', count);
    track.hidden = count === 0;
    if (count >= 1) track.style = `--pv-choice-columns:${String(count)}`;
    const model: Rail = {
      id,
      label,
      icon: null,
      node,
      track,
      additional: auxiliary.size > 0,
      choices: choices.map((choice, index) => ({
        value: choice.value,
        label: choice.label,
        additional: auxiliary.has(choice.value),
        chip: face('pv-kit pv-kit-chip pv-chip pv-kit-choice-label', {'data-kit': 'chip'}),
        input: face('', {type: 'radio', name: id, value: choice.value, id: `${id}-${String(index)}`}),
      })),
      note: null,
    };
    let selected = value,
      blocked = false;
    const element = (target: Face) => this.element(target),
      drawn = (target: Face) => this.drawn(target);
    const handle: RailHandle = {
      model,
      get node() {
        return drawn(model.node) as HTMLFieldSetElement;
      },
      get inputs() {
        return model.choices
          .map(choice => element(choice.input) as HTMLInputElement | null)
          .filter((input): input is HTMLInputElement => !!input);
      },
      get legend() {
        return element(model.node)?.querySelector('legend') ?? null;
      },
      get specialNote() {
        return model.note ? (element(model.note) ?? undefined) : undefined;
      },
      setValue: next => {
        selected = next;
        this.checkRail(model, next);
      },
      setDisabled: disabled => {
        blocked = disabled;
        setAttr(model.node, 'aria-disabled', blocked);
        for (const choice of model.choices) setAttr(choice.input, 'aria-disabled', blocked);
      },
      setChoiceDisabled: (choice, disabled) => {
        const row = model.choices.find(item => attr(item.input, 'value') === choice);
        if (row) setDisabled(row.input, disabled);
      },
    };
    for (const choice of model.choices) {
      this.listen(choice.input, 'change', event => {
        this.run(() => {
          const input = event.currentTarget as HTMLInputElement;
          if (blocked || input.disabled) {
            handle.setValue(selected);
            return;
          }
          if (input.checked) {
            selected = input.value;
            onChange?.(selected);
          }
        });
      });
    }
    this.rails.push({handle, value: () => selected, applied: false});
    return handle;
  }

  // The rail's setValue: each radio is checked exactly when its value is the given one.
  private checkRail(model: Rail, next: string | null | undefined): void {
    for (const choice of model.choices) {
      const input = this.elements.get(choice.input.id) as HTMLInputElement | undefined;
      if (!input) return;
      const checked = attr(choice.input, 'value') === String(next);
      if (input.checked !== checked) input.checked = checked;
    }
  }

  private buildCleaning(
    option: RobotOption,
    mapName: string | undefined,
    historyDraft: Record<string, unknown> | null,
  ) {
    this.cleaningOptionId = option.id;
    const schema = option.argsSchema,
      areas = schema.areas ?? [],
      repeatRange = schema.repeat ?? {min: 1, max: 1},
      zone = face('device-history robot-cleaning-zone'),
      form = face('robot-cleaning-form');
    kit(zone, 'card', {identity: 'robot'});
    setAttr(zone, 'data-kit-layout', 'controls');
    const formId = `robot-cleaning-${String(++cleaningSerial)}`;
    setAttr(form, 'id', formId);
    const map = this.buildMapSelector(mapName);
    const choices = face('choices pv-tiles');
    const rooms: RoomTile[] = areas.map(area => {
      const tile = face('pv-button pv-tile choice robot-room-tile', {type: 'button'});
      kit(tile, 'tile', {identity: 'robot', variant: 'compact'});
      setAttr(tile, 'name', 'areaIds');
      setAttr(tile, 'value', area.id);
      setAttr(tile, 'aria-pressed', 'false');
      return {face: tile, label: area.label, icon: roomIcon(area.label)};
    });
    type RoomButton = HTMLButtonElement & {checked?: boolean};
    const roomButtons = () =>
      rooms.map(room => this.element(room.face) as RoomButton | null).filter((n): n is RoomButton => !!n);
    for (const room of rooms) {
      this.listen(room.face, 'click', event => {
        this.run(() => {
          const input = event.currentTarget as RoomButton;
          if (input.disabled) return;
          input.checked = !input.checked;
          dirty();
          update();
        });
      });
    }
    this.proposalCaption = detached('p', 'Seneste rumvalg', 'pv-meta', 'meta');
    this.proposalCaption.hidden = true;
    this.proposalCaption.dataset.robotProposal = 'true';
    const proposalButton = createKitComponent('button', {
      document,
      text: 'Brug seneste valg',
      identity: 'robot',
      variant: 'secondary',
      className: 'pv-button',
    }) as Detached & HTMLButtonElement;
    this.proposalButton = proposalButton;
    proposalButton.type = 'button';
    proposalButton.hidden = true;
    proposalButton.dataset.robotProposal = 'true';
    this.proposalZone = detached('section', undefined, 'device-history pv-suggestions', null);
    applyKitComponent(this.proposalZone, 'listrow', {identity: 'robot', variant: 'read-only'});
    this.proposalZone.dataset.detailZone = 'suggestions';
    this.proposalZone.hidden = true;
    this.proposalZone.append(this.proposalCaption);
    const all = made('button', undefined, 'pv-button pv-ghost');
    kit(all, 'button', {identity: 'neutral', variant: 'quiet'});
    setAttr(all, 'data-kit-slot', 'header-action');
    setAttr(all, 'type', 'button');
    this.listen(all, 'click', event => {
      this.run(() => {
        if ((event.currentTarget as HTMLButtonElement).disabled) return;
        const rows = roomButtons(),
          selected = rows.every(row => row.checked);
        for (const row of rows) row.checked = !selected;
        dirty();
        update();
      });
    });
    const repeatControl = this.createRail({
        id: `${formId}-repeat`,
        label: 'Antal gange',
        choices: Array.from({length: repeatRange.max - repeatRange.min + 1}, (_, i) => ({
          value: String(repeatRange.min + i),
          label: `${String(repeatRange.min + i)}×`,
        })),
        value: String(repeatRange.min),
        onChange: () => {
          dirty();
          update();
        },
      }),
      repeat = repeatControl.model.node;
    this.decorateLevel(repeatControl, 'repeat');
    this.compactRepeat(repeatControl);
    addClasses(repeat, 'repeat', 'robot-level-setting');
    setAttr(repeat, 'data-setting-concept', 'repeat');
    for (const choice of repeatControl.model.choices) setAttr(choice.input, 'name', 'repeat');
    const summary = made('p', 'Vælg mindst ét rum', 'summary');
    summary.hidden = true;
    const submitFace = made('button', 'Start rengøring', 'pv-button pv-primary start');
    setText(submitFace, '');
    this.screen.submit = {face: submitFace, icon: 'assets/icons/play-fill.svg', label: 'Start rengøring'};
    this.faces.submit = submitFace;
    this.faces.form = form;
    setAttr(submitFace, 'data-kit-shape', 'pill');
    setAttr(submitFace, 'data-control-option-id', option.id);
    setAttr(submitFace, 'type', 'submit');
    setAttr(submitFace, 'form', formId);
    setAttr(submitFace, 'data-unready', 'true');
    kit(submitFace, 'button', {identity: 'robot', variant: 'primary'});
    const cleaningOptions = this.group('section', 'settings robot-cleaning-options');
    const typeOptions = this.group('div', 'robot-type-options');
    setAttr(typeOptions.face, 'role', 'group');
    setAttr(typeOptions.face, 'aria-label', 'Indstillinger for valgt type');
    this.faces.cleaningOptions = cleaningOptions;
    this.faces.cleaningTypeOptions = typeOptions;
    this.cleaningOptionsSummary = detached('p', 'Rengøringsvalg', 'pv-meta robot-setup-summary', 'meta');
    this.cleaningOptionsSummary.hidden = true;
    const startSettings = [...(schema.settings ?? [])].sort(
      (a, b) => settingOrder({settingKey: a.key, label: a.label}) - settingOrder({settingKey: b.key, label: b.label}),
    );
    for (const setting of startSettings) {
      const descriptor = {settingKey: setting.key, label: setting.label},
        concept = settingConcept(descriptor);
      const rail = this.createRail({
        id: `${formId}-${setting.id}`,
        label: settingLabel(descriptor),
        choices: visibleSettingChoices(descriptor, setting.choices).map(choice => ({
          value: choice.id,
          label: choiceLabel(descriptor, choice),
        })),
        auxiliaryValues: setting.choices
          .filter(choice => concept === 'mop_mode' && specialChoice(descriptor, choice))
          .map(choice => choice.id),
        value: setting.choices.some(choice => choice.id === setting.current) ? setting.current : null,
        onChange: next => {
          if (concept === 'mode') switchMode(control, next);
          else control.selected = next;
          dirty();
          update();
        },
      });
      const control: StartSettingControl = {
        setting,
        selected: setting.choices.some(choice => choice.id === setting.current) ? (setting.current ?? null) : null,
        rail,
        get buttons() {
          return rail.node;
        },
      };
      this.decorateLevel(rail, concept);
      if (concept === 'mop_mode') setAttr(rail.model.node, 'data-kit-size', 'compact');
      setAttr(rail.model.node, 'data-setting-concept', concept);
      addClasses(rail.model.node, 'setting', 'robot-staged-setting', 'robot-level-setting');
      for (const choice of rail.model.choices) {
        setAttr(choice.input, 'data-robot-choice-kind', 'settingChoice');
        setAttr(choice.input, 'data-setting-id', setting.id);
      }
      this.startSettingControls.push(control);
      (concept === 'mode' ? cleaningOptions : typeOptions).children.push({kind: 'rail', rail: rail.model});
    }
    typeOptions.children.push({kind: 'rail', rail: repeatControl.model});
    cleaningOptions.children.push(typeOptions);
    const recipeRows = this.value?.task?.recipeSummary;
    const recipe =
      Array.isArray(recipeRows) && recipeRows.length && !schema.settings?.length
        ? recipeRows.map(row => `${row.label}: ${row.value}`).join(' · ')
        : null;
    const card = face('robot-settings-zone');
    kit(card, 'card', {identity: 'robot'});
    setAttr(card, 'data-kit-layout', 'controls');
    setAttr(card, 'data-detail-zone', 'controls');
    setAttr(zone, 'data-detail-zone', 'controls');
    const section: CleaningSection = {
      kind: 'cleaning',
      form,
      zone,
      map,
      all,
      allContent: null,
      choices,
      rooms,
      card,
      recipe,
      options: cleaningOptions,
      summary,
    };
    this.screen.sections.push(section);
    const hero = this.screen.hero;
    if (hero) hero.transport = [{kind: 'submit'}, ...hero.transport];
    touch();
    const selectedAreas = () => roomButtons().filter(button => button.checked),
      selectedRepeat = () => repeatControl.inputs.find(button => button.checked);
    const settingConceptOf = (control: StartSettingControl) =>
      settingConcept({settingKey: control.setting.key, label: control.setting.label});
    // Each mode owns its unsent draft. Values are only restored locally; no
    // service command is sent when the mode or its defaults are changed.
    const modeDrafts = new Map<string | null, ModeDraft>();
    this.rebindCleaningDrafts = map => {
      const entries = [...modeDrafts].map(
        ([key, draft]) =>
          [
            key === null ? null : (map.get(key) ?? key),
            {
              ...draft,
              settings: new Map(
                [...draft.settings].map(([id, value]) => [
                  map.get(id) ?? id,
                  value === null ? null : (map.get(value) ?? value),
                ]),
              ),
            },
          ] as const,
      );
      modeDrafts.clear();
      for (const [key, draft] of entries) modeDrafts.set(key, draft);
    };
    const snapshotMode = (): ModeDraft => ({
      settings: new Map(
        this.startSettingControls
          .filter(control => settingConceptOf(control) !== 'mode')
          .map(control => [control.setting.id, control.selected]),
      ),
      repeat: Number(selectedRepeat()?.value),
    });
    // Saved alternatives contain only unambiguous native labels/setting keys.
    // They are presentation drafts, never option IDs or command authority.
    this.readModeDrafts = () => {
      const modeControl = this.startSettingControls.find(control => settingConceptOf(control) === 'mode'),
        result: SavedModeDrafts['items'] = [];
      if (!modeControl) return {ok: modeDrafts.size === 0, items: []};
      for (const [id, draft] of modeDrafts) {
        const modes = modeControl.setting.choices.filter(choice => choice.id === id),
          mode = modes[0]?.label;
        if (
          modes.length !== 1 ||
          modeControl.setting.choices.filter(choice => choice.label === mode).length !== 1 ||
          !Number.isInteger(draft.repeat)
        )
          return {ok: false, items: []};
        const settings: {key: string | undefined; label: string | null}[] = [];
        for (const [settingId, choiceId] of draft.settings) {
          const controls = this.startSettingControls.filter(control => control.setting.id === settingId),
            control = controls[0],
            key = control?.setting.key;
          if (controls.length !== 1 || this.startSettingControls.filter(row => row.setting.key === key).length !== 1)
            return {ok: false, items: []};
          if (choiceId === null) {
            settings.push({key, label: null});
            continue;
          }
          const selected = control?.setting.choices.filter(choice => choice.id === choiceId) ?? [],
            label = selected[0]?.label;
          if (selected.length !== 1 || control?.setting.choices.filter(choice => choice.label === label).length !== 1)
            return {ok: false, items: []};
          settings.push({key, label: label ?? null});
        }
        result.push({mode, settings, repeat: Number(draft.repeat)});
      }
      return {ok: true, items: result};
    };
    this.applyModeDrafts = saved => {
      if (!saved?.ok || !Array.isArray(saved.items)) {
        this.draftFeedback = NOT_RESTORED;
        this.updateObservation();
        return false;
      }
      const modeControl = this.startSettingControls.find(control => settingConceptOf(control) === 'mode');
      if (!modeControl) {
        if (saved.items.length) {
          this.draftFeedback = NOT_RESTORED;
          this.updateObservation();
          return false;
        }
        return true;
      }
      const mapped = new Map<string, ModeDraft>();
      let complete = true;
      for (const draft of saved.items) {
        const modes = modeControl.setting.choices.filter(choice => choice.label === draft.mode);
        const first = modes[0];
        if (modes.length !== 1 || !first || mapped.has(first.id) || !Array.isArray(draft.settings)) {
          complete = false;
          continue;
        }
        const settings = new Map<string, string | null>(),
          seen = new Set<string>();
        for (const control of this.startSettingControls)
          if (control !== modeControl) settings.set(control.setting.id, null);
        for (const row of draft.settings as unknown[]) {
          const item = row as {key?: unknown; label?: unknown} | null;
          if (!item || typeof item.key !== 'string' || seen.has(item.key)) {
            complete = false;
            continue;
          }
          seen.add(item.key);
          const controls = this.startSettingControls.filter(
              control => control.setting.key === item.key && control !== modeControl,
            ),
            control = controls[0];
          if (controls.length !== 1 || !control) {
            complete = false;
            continue;
          }
          if (item.label === null) {
            settings.set(control.setting.id, null);
            continue;
          }
          const found = control.setting.choices.filter(choice => choice.label === item.label);
          if (found.length !== 1 || !found[0]) {
            complete = false;
            continue;
          }
          settings.set(control.setting.id, found[0].id);
        }
        if (
          this.startSettingControls.some(
            control => control !== modeControl && !seen.has(control.setting.key ?? ''),
          )
        )
          complete = false;
        const offered = repeatControl.model.choices.some(
          choice => Number(attr(choice.input, 'value')) === draft.repeat,
        );
        const repeatValue = offered ? draft.repeat : null;
        if (repeatValue === null) complete = false;
        mapped.set(first.id, {settings, repeat: repeatValue});
      }
      modeDrafts.clear();
      for (const [key, value] of mapped) modeDrafts.set(key, value);
      if (!complete) {
        this.draftFeedback = NOT_RESTORED;
        this.updateObservation();
      }
      return complete;
    };
    const switchMode = (modeControl: StartSettingControl, next: string) => {
      if (next === modeControl.selected) return;
      modeDrafts.set(modeControl.selected, snapshotMode());
      const saved = modeDrafts.get(next),
        mode = cleaningMode(modeControl.setting.choices.find(choice => choice.id === next)?.label);
      modeControl.selected = next;
      for (const control of this.startSettingControls) {
        const concept = settingConceptOf(control);
        if (concept === 'mode') continue;
        if (saved?.settings.has(control.setting.id)) {
          const previous = saved.settings.get(control.setting.id);
          control.selected = control.setting.choices.some(choice => choice.id === previous) ? (previous ?? null) : null;
          continue;
        }
        // Irrelevant fields remain a hidden, owner-offered transport prerequisite.
        if (irrelevantSetting(concept, mode)) {
          const current = control.setting.choices.some(choice => choice.id === control.selected)
            ? control.selected
            : control.setting.current;
          control.selected = control.setting.choices.some(choice => choice.id === current) ? (current ?? null) : null;
          continue;
        }
        // Product presets are resolved only against the current owner's offered IDs.
        const presets: Record<string, string[]> = {
            suction: ['balanced', 'balanceret', 'normal'],
            water: ['medium', 'mellem', 'moderate', 'normal'],
            mop_mode: ['standard'],
          },
          labels = mode ? presets[concept] : null;
        const matches = labels
          ? control.setting.choices.filter(choice => labels.includes(choice.label.trim().toLocaleLowerCase('da-DK')))
          : [];
        control.selected = matches.length === 1 ? (matches[0]?.id ?? null) : null;
      }
      const offeredRepeats = repeatControl.model.choices.map(choice => Number(attr(choice.input, 'value'))),
        desired = saved
          ? offeredRepeats.includes(saved.repeat ?? NaN)
            ? saved.repeat
            : null
          : offeredRepeats.includes(1)
            ? 1
            : Math.min(...offeredRepeats);
      for (const input of repeatControl.inputs) input.checked = Number(input.value) === desired;
    };
    const update = () => {
      for (const room of rooms) {
        const button = (this.element(room.face) as RoomButton | null);
        const checked = !!button?.checked;
        setAttr(room.face, 'data-selected', String(checked));
        setAttr(room.face, 'aria-pressed', String(checked));
        kit(room.face, 'tile', {identity: 'robot', selected: checked});
      }
      for (const control of this.startSettingControls) control.rail.setValue(control.selected);
      const modeControl = this.startSettingControls.find(
          control => settingConcept({settingKey: control.setting.key}) === 'mode',
        ),
        mode = cleaningMode(modeControl?.setting.choices.find(choice => choice.id === modeControl.selected)?.label);
      for (const control of this.startSettingControls) {
        const descriptor = {settingKey: control.setting.key, label: control.setting.label},
          concept = settingConcept(descriptor),
          node = control.rail.model.node;
        setHidden(node, !!control.selected && irrelevantSetting(concept, mode));
        if (['suction', 'water'].includes(concept)) setAttr(node, 'data-robot-mode', mode || '');
        const hiddenByProduct = this.productModeChoices(
          control.rail.model,
          descriptor,
          control.setting.choices,
          control.selected,
          mode,
        );
        if (concept === 'mop_mode') this.updateRouteWidth(control.rail.model, mode);
        control.unavailable = this.specialNote(
          control.rail.model,
          descriptor,
          control.setting.choices,
          control.selected,
          hiddenByProduct,
        );
      }
      const selected = selectedAreas(),
        chosen = selectedRepeat(),
        count = chosen ? Number(chosen.value) : null;
      const everything = selected.length === areas.length;
      this.buttonContent(section, {
        label: everything ? 'Fravælg alle' : 'Vælg alle',
        icon: everything ? 'assets/icons/x-lg.svg' : 'assets/icons/check2.svg',
      });
      if (this.cleaningOptionsSummary) this.cleaningOptionsSummary.textContent = this.cleaningSummary(count);
      setText(
        summary,
        selected.length && count !== null
          ? `${selected.map(el => areas.find(a => a.id === el.value)?.label ?? '').join(', ')} · ${String(count)} ${
              count === 1 ? 'gang' : 'gange'
            }`
          : count === null
            ? 'Vælg antal gange'
            : 'Vælg mindst ét rum',
      );
      const submit = this.screen.submit;
      if (submit) {
        const first = selected[0];
        const label =
          selected.length === 1 && first
            ? `Start i ${first.querySelector('span')?.textContent ?? ''}`
            : selected.length
              ? `Start · ${String(selected.length)} rum`
              : 'Vælg rum';
        // Without a chosen room the main button stays live and leads to the room picker; the offer
        // has no whole-home start, so nothing is started without rooms (S12).
        setAttr(submit.face, 'data-needs-rooms', String(!selected.length));
        const startIcon = selected.length ? 'assets/icons/play-fill.svg' : 'assets/icons/check2.svg';
        if (submit.label !== label || submit.icon !== startIcon) {
          submit.label = label;
          submit.icon = startIcon;
          touch();
        }
        setAttr(
          submit.face,
          'data-unready',
          String(
            !!selected.length &&
              (count === null ||
                this.startSettingControls.some(
                  control => !control.selected || (!control.rail.model.node.hidden && control.unavailable),
                )),
          ),
        );
      }
      this.syncDisabledNow();
    };
    this.readCleaningDraft = () => ({
      areaIds: selectedAreas().map(row => row.value),
      repeat: selectedRepeat() ? Number(selectedRepeat()?.value) : null,
      ...(this.startSettingControls.length
        ? {
            settingChoices: this.startSettingControls
              .filter(control => control.selected)
              .map(control => ({settingId: control.setting.id, choiceId: control.selected ?? ''})),
          }
        : {}),
    });
    this.applyCleaningDraft = draft =>
      this.run(() => {
        const draftAreas = draft.areaIds,
          draftRepeat = draft.repeat;
        if (
          !Array.isArray(draftAreas) ||
          draftAreas.some(id => !areas.some(area => area.id === id)) ||
          typeof draftRepeat !== 'number' ||
          !Number.isInteger(draftRepeat) ||
          draftRepeat < repeatRange.min ||
          draftRepeat > repeatRange.max
        )
          return false;
        const settings = draft.settings as Record<string, unknown> | undefined;
        if (!draft.settingChoices && settings) {
          for (const control of this.startSettingControls) {
            if (control.setting.key !== undefined && Object.hasOwn(settings, control.setting.key)) {
              const chosen = settings[control.setting.key];
              const offered = control.setting.choices.some(choice => choice.id === chosen);
              control.selected = offered ? (chosen as string) : null;
            }
          }
        }
        if (Array.isArray(draft.settingChoices)) {
          const rows = draft.settingChoices as {settingId?: unknown; choiceId?: unknown}[];
          for (const control of this.startSettingControls) {
            const chosen = rows.find(choice => choice.settingId === control.setting.id);
            control.selected =
              chosen && control.setting.choices.some(choice => choice.id === chosen.choiceId)
                ? (chosen.choiceId as string)
                : null;
          }
        }
        for (const input of roomButtons()) input.checked = (draftAreas as unknown[]).includes(input.value);
        for (const input of repeatControl.inputs) input.checked = Number(input.value) === draftRepeat;
        update();
        return true;
      });
    this.refreshCleaningSummary = () => {
      this.run(update);
    };
    const dirty = () => {
      if (this.draftFeedback) {
        this.draftFeedback = null;
        this.updateObservationNow();
      }
      this.cleaningDirty = true;
      this.dispatchEvent(new CustomEvent('robot-draft-changed', {bubbles: true, composed: true}));
      this.cleaningApplied = false;
      proposalButton.dataset.unready = String(!this.validSuggestion(this.currentSuggestion));
      proposalButton.textContent = 'Brug seneste valg';
      if (this.proposalCaption) this.proposalCaption.textContent = 'Tilpassede valg';
    };
    this.listen(form, 'change', () => {
      this.run(() => {
        dirty();
        update();
      });
    });
    proposalButton.addEventListener('click', () => {
      this.run(() => {
        const suggestion = this.validSuggestion(this.currentSuggestion),
          value = this.value ?? {};
        if (
          this._disabled ||
          proposalButton.disabled ||
          !this.isConnected ||
          value.connected === false ||
          value.pendingOptionId ||
          value.device?.stale ||
          value.device?.pending ||
          !suggestion
        )
          return;
        for (const input of roomButtons()) input.checked = suggestion.areaIds.includes(input.value);
        for (const input of repeatControl.inputs) input.checked = Number(input.value) === suggestion.repeat;
        this.cleaningDirty = true;
        this.cleaningApplied = true;
        proposalButton.textContent = 'Valg brugt';
        proposalButton.dataset.unready = 'true';
        update();
      });
    });
    if (historyDraft) {
      const ids = historyDraft.areaIds as string[];
      for (const input of roomButtons()) input.checked = ids.includes(input.value);
      for (const input of repeatControl.inputs) input.checked = Number(input.value) === historyDraft.repeat;
      this.cleaningDirty = true;
      this.historyApplied = true;
      this.proposalCaption.textContent = 'Dit tidligere rumvalg';
      this.proposalCaption.hidden = true;
      this.proposalZone.hidden = true;
      update();
    }
    if (this.value?.task?.draft?.status === 'not_restored') {
      for (const control of this.startSettingControls) control.selected = null;
      for (const input of repeatControl.inputs) input.checked = false;
      update();
    }
    const selectedAreaId = this.value?.selectedAreaId;
    if (!historyDraft && areas.some(area => area.id === selectedAreaId)) {
      for (const input of roomButtons()) input.checked = input.value === selectedAreaId;
      this.cleaningDirty = true;
      update();
    }
    update();
    this.listen(form, 'submit', event => {
      this.run(() => {
        event.preventDefault();
        const areaIds = selectedAreas().map(x => x.value);
        if (!areaIds.length) {
          const fieldset = this.element(choices);
          (fieldset as Partial<HTMLElement> | null)?.scrollIntoView?.({block: 'center', behavior: 'smooth'});
          fieldset?.querySelector('button')?.focus({preventScroll: true});
          return;
        }
        if (
          selectedRepeat() &&
          !this.startSettingControls.some(
            control => !control.selected || (!control.rail.model.node.hidden && control.unavailable),
          )
        )
          this.action(option, this.readCleaningDraft?.() as unknown as Record<string, unknown>);
      });
    });
  }

  // syncKitButtonContent for the »Vælg alle« button: icon + label.
  private buttonContent(section: CleaningSection, content: {label: string; icon: string}): void {
    if (!section.allContent) setAttr(section.all, 'data-kit-content', 'icon-label');
    if (section.allContent?.label === content.label && section.allContent.icon === content.icon) return;
    section.allContent = content;
    touch();
  }

  // Product presentation narrows only source-offered choices for a known mode; this is not a hardware capability claim.
  private productModeChoices(
    rail: Rail,
    option: {settingKey?: string | undefined; label?: string | undefined},
    choices: RobotChoice[],
    current: unknown,
    mode: string | null,
  ): boolean {
    const concept = settingConcept(option),
      scoped = ['both', 'vacuum', 'mop'].includes(mode ?? '') && ['suction', 'mop_mode'].includes(concept);
    let visible = 0,
      hiddenSelected = false;
    for (const row of rail.choices) {
      const value = attr(row.input, 'value');
      const choice = choices.find(item => item.id === value),
        label = choice ? choiceLabel(option, choice).trim().toLocaleLowerCase('da-DK') : '',
        isMaxPlus = ['max_plus', 'max+', 'maks.+'].includes(label),
        isDeep = ['deep', 'deep_plus', 'deep+', 'dyb', 'dyb+', 'grundig', 'grundig+'].includes(label),
        hidden = (
          scoped &&
          ((concept === 'suction' && mode === 'both' && isMaxPlus) ||
            (concept === 'mop_mode' && ['both', 'vacuum'].includes(mode ?? '') && isDeep))
        );
      setHidden(row.chip, hidden);
      if (!hidden) visible++;
      else if (value === current) hiddenSelected = true;
    }
    if (rail.choices.length) {
      setAttr(rail.track, 'data-choice-count', String(visible));
      if (visible) setStyle(rail.track, `--pv-choice-columns:${String(visible)}`);
    }
    return hiddenSelected;
  }

  private updateRouteWidth(rail: Rail, mode: string | null): void {
    if (mode === 'mop' && rail.choices.filter(choice => !choice.chip.hidden).length >= 4)
      removeAttr(rail.node, 'data-kit-size');
    else setAttr(rail.node, 'data-kit-size', 'compact');
  }

  private specialNote(
    rail: Rail,
    option: {settingKey?: string | undefined; label?: string | undefined},
    choices: RobotChoice[],
    current: unknown,
    hiddenByProduct = false,
  ): boolean {
    let note = rail.note;
    const choice =
      specialSelection(option, choices, current) ??
      (hiddenByProduct ? choices.find(row => row.id === current) : undefined);
    if (!note && choice) {
      note = made('p', '', 'pv-meta');
      setAttr(note, 'data-special-selection', 'true');
      setAttr(note, 'role', 'status');
      rail.note = note;
      touch();
    }
    if (note) {
      setHidden(note, !choice);
      setText(
        note,
        choice
          ? `Aktuel indstilling: ${choiceLabel(option, choice)}. Kan ikke vælges her; vælg et andet niveau.`
          : '',
      );
    }
    return !!choice;
  }

  cleaningSummary(count: number | null): string {
    const times = `${String(count)} ${count === 1 ? 'gang' : 'gange'}`;
    if (this.startSettingControls.length) {
      const details = this.startSettingControls.map(control => {
        const choice = control.setting.choices.find(row => row.id === control.selected),
          descriptor = {settingKey: control.setting.key, label: control.setting.label};
        return choice
          ? compactSetting(settingConcept(descriptor), descriptor.label, choice.label)
          : `${descriptor.label} skal vælges`;
      });
      return `Rengøringsvalg · ${[...details, times].join(' · ')}`;
    }
    const offered = robotControlGroups(this.value?.task).settings.filter(
        option => option.argsSchema.kind === 'choice' && frequentSetting(option),
      ),
      confirmed = offered.flatMap(option => {
        const choice = (option.argsSchema.choices ?? []).find(row => row.id === settingCurrent(this.value, option));
        return choice ? [{concept: settingConcept(option), label: option.label, value: choice.label}] : [];
      }),
      observed = robotFacts(this.value?.device ?? {})
        .details.filter(
          row =>
            row.group === 'settings' &&
            !row.stale &&
            ['Rengøringstilstand', 'Moppeintensitet', 'Moppetilstand'].includes(row.label),
        )
        .map(row => ({...row, concept: settingConcept(row)})),
      rows = [...confirmed, ...observed.filter(row => !confirmed.some(choice => choice.concept === row.concept))],
      order = ['mode', 'suction', 'water', 'mop_mode'];
    rows.sort((a, b) => order.indexOf(a.concept) - order.indexOf(b.concept));
    const details = rows.map(row => compactSetting(row.concept, row.label, row.value));
    const unknown = offered.filter(option => !rows.some(row => row.concept === settingConcept(option)));
    if (unknown.length)
      details.push(
        rows.length
          ? unknown.map(option => `${option.label} ikke rapporteret`).join(' · ')
          : 'aktuelle indstillinger ikke rapporteret',
      );
    return `Rengøringsvalg · ${[...details, times].join(' · ')}`;
  }

  private updateCurrentRooms(): void {
    const section = this.faces.currentRooms;
    if (!section) return;
    const areas = this.value?.currentSetup?.areas,
      valid =
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
        new Set(areas.map((area: {id: string}) => area.id)).size === areas.length,
      signature = valid ? JSON.stringify(areas) : 'unknown';
    if (signature === this.currentAreasSignature) return;
    this.currentAreasSignature = signature;
    section.rooms = [];
    touch();
    setHidden(section.list, !valid);
    setHidden(section.unknown, valid);
    if (!valid) return;
    for (const area of areas as {id: string; label: string}[]) {
      const tile = face('pv-tile robot-room-tile robot-current-room-tile');
      kit(tile, 'tile', {identity: 'robot', variant: 'compact'});
      setAttr(tile, 'data-selected', 'true');
      setAttr(tile, 'aria-label', area.label);
      section.rooms.push({face: tile, label: area.label, icon: roomIcon(area.label)});
    }
  }

  decorateLevel(rail: RailHandle, concept: string): RailHandle {
    const asset = LEVEL_ICONS[concept];
    if (asset && !rail.model.icon) {
      rail.model.icon = `assets/icons/${asset}.svg`;
      touch();
    }
    return rail;
  }

  private buildSetting(parent: Part & {kind: 'group'}, option: RobotOption, readOnly = false): void {
    const concept = settingConcept(option),
      asset = LEVEL_ICONS[concept];
    if (readOnly) {
      const row = face('setting robot-setting-readonly');
      kit(row, 'listrow', {identity: 'robot', variant: 'read-only'});
      setAttr(row, 'data-setting-concept', concept);
      const title = made('h4', settingLabel(option)),
        value = made('p', '', 'robot-setting-value');
      textRole(value, 'control-value');
      const element = (target: Face) => this.drawn(target);
      this.settingControls.push({
        option,
        faces: {wrapper: row, value},
        get readOnly() {
          return element(value);
        },
        get wrapper() {
          return element(row);
        },
      });
      const icon = asset ? `assets/icons/${asset}.svg` : null;
      parent.children.push({kind: 'readonly', face: row, title, icon, value});
      return;
    }
    const schema = option.argsSchema,
      frequent = schema.kind === 'choice' && frequentSetting(option),
      wrapper = made(frequent ? 'fieldset' : 'form', undefined, 'setting'),
      submit = made('button', `Anvend ${option.label.toLocaleLowerCase('da-DK')}`, 'pv-button');
    setAttr(submit, 'data-control-option-id', option.id);
    setAttr(submit, 'type', 'submit');
    setAttr(submit, 'data-unready', 'true');
    kit(
      wrapper,
      'listrow',
      frequent || (schema.kind === 'number' && concept === 'repeat')
        ? {identity: 'robot', variant: 'settings'}
        : {identity: 'robot'},
    );
    const unit = schema.kind === 'number' ? ` (${schema.unit ?? ''})` : '';
    const title = made('h4', option.label + unit, 'pv-section-header');
    const element = (target: Face) => this.drawn(target);
    const min = schema.min,
      max = schema.max;
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
      const rail = this.createRail({
        id: `robot-repeat-${String(++cleaningSerial)}`,
        label: 'Antal gange',
        choices: Array.from({length: max - min + 1}, (_, i) => ({
          value: String(min + i),
          label: `${String(min + i)}×`,
        })),
        value: String(settingCurrent(this.value, option)),
        onChange: next => {
          const current = settingCurrent(this.value, option);
          rail.setValue(String(current));
          if (Number(next) !== current) this.action(option, {value: Number(next)});
        },
      });
      this.decorateLevel(rail, 'repeat');
      this.compactRepeat(rail);
      setAttr(wrapper, 'data-setting-concept', 'repeat');
      setAttr(rail.model.node, 'data-setting-concept', 'repeat');
      addClasses(wrapper, 'robot-setting-wrapper');
      addClasses(rail.model.node, 'robot-level-setting');
      for (const choice of rail.model.choices) setAttr(choice.input, 'data-control-option-id', option.id);
      this.settingControls.push({
        option,
        rail,
        numeric: true,
        faces: {wrapper},
        get wrapper() {
          return element(wrapper);
        },
      });
      parent.children.push({kind: 'wrapper', tag: 'form', face: wrapper, rail: rail.model, submit: null});
      return;
    }
    if (schema.kind === 'boolean') {
      const toggle = made('button', '', 'pv-button');
      setAttr(toggle, 'type', 'button');
      kit(toggle, 'toggle', {identity: 'robot'});
      setAttr(toggle, 'data-control-option-id', option.id);
      this.listen(toggle, 'click', () => {
        this.run(() => {
          const current = settingCurrent(this.value, option);
          if (!toggle.disabled && typeof current === 'boolean') this.action(option, {value: !current});
        });
      });
      this.settingControls.push({
        option,
        faces: {toggle},
        get toggle() {
          return element(toggle) as HTMLButtonElement;
        },
      });
      parent.children.push({kind: 'toggle', face: wrapper, title, toggle});
      return;
    }
    if (schema.kind === 'choice') {
      const indirect: IndirectControl = {choiceId: null};
      this.indirectChoiceControls.push(indirect);
      const choices = schema.choices ?? [];
      const rail = this.createRail({
        id: `robot-setting-${String(++cleaningSerial)}`,
        label: settingLabel(option),
        choices: visibleSettingChoices(option, choices).map(choice => ({
          value: choice.id,
          label: choiceLabel(option, choice),
        })),
        auxiliaryValues: choices
          .filter(choice => concept === 'mop_mode' && specialChoice(option, choice))
          .map(choice => choice.id),
        value: settingCurrent(this.value, option) as string | null | undefined,
        onChange: next => {
          if (frequent) {
            const current = settingCurrent(this.value, option);
            rail.setValue(current as string | null | undefined);
            if (current !== next) this.action(option, {choiceId: next});
          } else {
            indirect.choiceId = next;
            setAttr(submit, 'data-unready', 'false');
            this.syncDisabledNow();
          }
        },
      });
      indirect.rail = rail;
      this.decorateLevel(rail, concept);
      if (concept === 'repeat') this.compactRepeat(rail);
      else if (concept === 'mop_mode') setAttr(rail.model.node, 'data-kit-size', 'compact');
      for (const choice of rail.model.choices) {
        setAttr(choice.input, 'data-robot-choice-kind', 'choiceId');
        setAttr(choice.input, 'data-control-option-id', option.id);
      }
      addClasses(wrapper, 'robot-setting-wrapper');
      setAttr(wrapper, 'data-setting-concept', concept);
      setAttr(rail.model.node, 'data-setting-concept', concept);
      addClasses(rail.model.node, 'robot-level-setting');
      if (frequent) {
        this.settingControls.push({
          option,
          rail,
          faces: {wrapper},
          get group() {
            return rail.node;
          },
          get wrapper() {
            return element(wrapper);
          },
        });
        this.listen(wrapper, 'submit', event => {
          event.preventDefault();
        });
        parent.children.push({kind: 'wrapper', tag: 'fieldset', face: wrapper, rail: rail.model, submit: null});
      } else {
        this.listen(wrapper, 'submit', event => {
          this.run(() => {
            event.preventDefault();
            if (this._disabled || submit.disabled || !choices.some(choice => choice.id === indirect.choiceId)) return;
            this.action(option, {choiceId: indirect.choiceId});
          });
        });
        parent.children.push({kind: 'wrapper', tag: 'form', face: wrapper, rail: rail.model, submit});
      }
      return;
    }
    const input = face('', {type: schema.kind, 'aria-label': title.text});
    if (schema.kind === 'number') {
      setAttr(input, 'min', String(schema.min));
      setAttr(input, 'max', String(schema.max));
      setAttr(input, 'step', String(schema.step));
    } else setAttr(input, 'step', '1');
    const field = () => (this.element(input) as HTMLInputElement | null);
    const valid = () => {
      const node = field();
      if (!node) return false;
      return schema.kind === 'number'
        ? Number.isFinite(node.valueAsNumber) &&
            node.valueAsNumber >= (schema.min ?? 0) &&
            node.valueAsNumber <= (schema.max ?? 0) &&
            node.valueAsNumber !== schema.current &&
            node.checkValidity()
        : /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(node.value) &&
            (node.value.length === 5 || node.value.length === 8) &&
            node.value !== schema.current;
    };
    for (const type of ['input', 'change'])
      this.listen(input, type, () => {
        this.run(() => {
          setAttr(submit, 'data-unready', String(!valid()));
          this.syncDisabledNow();
        });
      });
    this.listen(wrapper, 'submit', event => {
      this.run(() => {
        event.preventDefault();
        const node = field();
        if (this._disabled || attr(submit, 'data-unready') === 'true' || !valid() || !node) return;
        this.action(option, schema.kind === 'number' ? {value: node.valueAsNumber} : {time: node.value});
      });
    });
    parent.children.push({kind: 'field', face: wrapper, title, input, submit});
    // The typed value is the input's own state (the old renderer set input.value, never the attribute).
    this.fieldValues.push({input, value: String(schema.current)});
  }

  private fieldValues: {input: Face; value: string}[] = [];

  updateSettingValues(): void {
    this.run(() => {
      this.updateSettingValuesNow();
    });
  }

  private updateSettingValuesNow(): void {
    for (const field of this.fieldValues.splice(0)) {
      const node = (this.element(field.input) as HTMLInputElement | null);
      if (node) node.value = field.value;
    }
    this.mapControl?.paint();
    const controls = this.settingControls,
      modeOption = controls.find(control => settingConcept(control.option) === 'mode'),
      mode = cleaningMode(
          modeOption?.option.argsSchema.choices?.find(
          choice => choice.id === settingCurrent(this.value, modeOption.option),
        )?.label,
      );
    for (const control of controls) {
      const {option, rail, numeric} = control,
        current = settingCurrent(this.value, option),
        concept = settingConcept(option);
      const value = control.faces.value,
        wrapper = control.faces.wrapper,
        toggle = control.faces.toggle;
      if (value) {
        const choice = option.argsSchema.choices?.find(row => row.id === current),
          known = !!choice || (option.argsSchema.kind === 'number' && Number.isFinite(current));
        let text = choice ? choiceLabel(option, choice) : known ? String(current) : 'Ikke oplyst';
        if (this.value?.connected === false || this.value?.device?.stale) text += ' · ikke opdateret';
        setText(value, text);
        if (wrapper) setHidden(wrapper, known && irrelevantSetting(concept, mode));
        continue;
      }
      if (toggle) {
        const known = typeof current === 'boolean';
        setText(toggle, known ? (current ? 'Slå fra' : 'Slå til') : 'Aktuel værdi ukendt');
        setAttr(toggle, 'aria-checked', known ? String(current) : 'false');
        setAttr(toggle, 'data-unready', String(!known));
        continue;
      }
      if (!rail) continue;
      rail.setValue(numeric ? String(current) : (current as string | null | undefined));
      if (!numeric) {
        if (['suction', 'water'].includes(concept)) setAttr(rail.model.node, 'data-robot-mode', mode || '');
        const choices = option.argsSchema.choices ?? [];
        const hiddenByProduct = this.productModeChoices(rail.model, option, choices, current, mode);
        if (concept === 'mop_mode') this.updateRouteWidth(rail.model, mode);
        this.specialNote(rail.model, option, choices, current, hiddenByProduct);
      }
      if (wrapper && !numeric)
        setHidden(
          wrapper,
          (option.argsSchema.choices ?? []).some(choice => choice.id === current) && irrelevantSetting(concept, mode),
        );
    }
  }

  private buildDock(options: RobotOption[]): void {
    const stops = options.filter(option => option.argsSchema.operation?.endsWith('_stop')),
      starts = options.filter(option => !option.argsSchema.operation?.endsWith('_stop'));
    const buttonFor = (option: RobotOption): string => {
      const operation = option.argsSchema.operation ?? '';
      const labels: Record<string, string> = {wash_start: 'Vask', empty_start: 'Tøm støv', dry_start: 'Tør'};
      const full: Record<string, string> = {
        wash_start: 'Vask moppe',
        empty_start: 'Tøm støvbeholder',
        dry_start: 'Tør moppe',
      };
      const target = made('button', labels[operation] || option.label, 'pv-button');
      setAttr(target, 'type', 'button');
      setAttr(target, 'data-kit-shape', 'pill');
      setAttr(target, 'data-control-option-id', option.id);
      setAttr(target, 'data-dock-operation', operation);
      const fullLabel = full[operation];
      if (fullLabel) setAttr(target, 'aria-label', fullLabel);
      const icon = operation.endsWith('_stop')
        ? 'stop'
        : operation.startsWith('wash')
          ? 'drop'
          : operation.startsWith('empty')
            ? 'vacuum'
            : 'wind';
      this.screen.actions[target.id] = {
        face: target,
        icon: {tag: 'img', src: `assets/icons/${icon}.svg`},
        label: target.text,
      };
      this.listen(target, 'click', () => {
        this.run(() => {
          if (!target.disabled) this.action(option);
        });
      });
      return target.id;
    };
    // Lærred »A-Robot«: the hero holds the primary action and »Mere ▾« only. A running base operation's stop
    // comes first in Mere (amber, »Basen · …«), so it never shows as a second dark button beside Start.
    const base = stops.length || starts.length ? this.baseActions() : null;
    if (!base) return;
    if (stops.length) {
      const keys = stops.map(option => {
        const key = buttonFor(option);
        const button = this.screen.actions[key];
        if (button) setAttr(button.face, 'data-base-attention', 'true');
        return key;
      });
      base.items = [...keys, ...base.items];
    }
    if (starts.length) base.items = [...base.items, ...starts.map(buttonFor)];
    touch();
  }

  // createKitDisclosure »Mere« inside the hero's transport row.
  private baseActions(): Base {
    if (this.faces.base) return this.faces.base;
    const id = `robot-base-${String(++cleaningSerial)}`;
    const node = face('pv-kit-disclosure robot-dock-actions', {'data-kit-layout': 'header-more'});
    const trigger = face('', {type: 'button'});
    kit(trigger, 'listrow');
    setAttr(trigger, 'id', `${id}-trigger`);
    setAttr(trigger, 'aria-controls', `${id}-panel`);
    setAttr(trigger, 'data-leading-icon', 'true');
    setAttr(trigger, 'data-kit-shape', 'pill');
    const description = face('', {'data-kit-text': 'meta', 'data-kit-slot': 'description'});
    const panel = face('', {id: `${id}-panel`, 'aria-labelledby': `${id}-trigger`, role: 'region'});
    const base: Base = {id, node, trigger, description, panel, items: []};
    this.screen.base = base;
    this.faces.base = base;
    let expanded = false,
      disabled = false;
    const element = (target: Face) => this.drawn(target);
    const setExpanded = (value: boolean) => {
      expanded = value && !disabled;
      const panelNode = this.elements.get(panel.id);
      if (!expanded && panelNode?.contains(document.activeElement))
        (this.elements.get(trigger.id) as HTMLElement).focus();
      setAttr(trigger, 'aria-expanded', expanded);
      setHidden(panel, !expanded);
    };
    const setDescription = (value: string) => {
      setText(description, value || '');
      setHidden(description, !value);
      setAttr(trigger, 'data-has-summary', !!value);
      setAttr(description, 'aria-hidden', !value);
    };
    this.baseDisclosure = {
      get node() {
        return element(node);
      },
      get trigger() {
        return element(trigger) as HTMLButtonElement;
      },
      get panel() {
        return element(panel);
      },
      setExpanded: value => {
        this.run(() => {
          setExpanded(value);
        });
      },
      setDescription: value => {
        this.run(() => {
          setDescription(value);
        });
      },
      setDisabled: value => {
        this.run(() => {
          disabled = value;
          if (disabled) setExpanded(false);
          setDisabled(trigger, disabled);
          const node = this.elements.get(trigger.id) as HTMLButtonElement | undefined;
          if (node && node.disabled !== disabled) node.disabled = disabled;
          setAttr(trigger, 'aria-disabled', disabled);
        });
      },
    };
    this.listen(trigger, 'click', () => {
      this.run(() => {
        if (disabled) return;
        setExpanded(!expanded);
      });
    });
    setExpanded(false);
    setDescription('');
    const hero = this.screen.hero;
    if (hero) hero.transport = [...hero.transport, {kind: 'base'}];
    touch();
    return base;
  }

  // iPad (lærred »Robot-Sticky«): when the hero has scrolled away, a 72-px line under the topbar repeats the hero's
  // title, line and primary action and offers »Mere«. It owns no state: both buttons hand the tap to the hero's own
  // controls, so the hero's rules (queueing, confirmation, disabled) stay the only ones.
  private buildStickyLine(): void {
    this.stickyObserver?.disconnect();
    this.stickyObserver = null;
    // A touch shortcut, not controls of its own: the hero keeps the only buttons and the only copy of each text
    // (the line draws its texts from data-text in CSS and is hidden from assistive technology).
    const sticky: Sticky = {
      line: face('robot-sticky', {'aria-hidden': 'true', 'data-shown': 'false'}),
      title: face('robot-sticky-title'),
      sub: face('robot-sticky-sub'),
      primary: face('robot-sticky-primary'),
      more: face('robot-sticky-more', {'data-text': 'Mere'}),
    };
    this.screen.sticky = sticky;
    touch();
    this.listen(sticky.primary, 'click', () => {
      const target = this.stickyPrimaryTarget();
      const node = target ? (this.element(target) as HTMLButtonElement | null) : null;
      if (node && !node.disabled) node.click();
    });
    this.listen(sticky.more, 'click', () => {
      const trigger = this.baseDisclosure?.trigger;
      if (!trigger) return;
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
      (this.observation as Partial<HTMLElement> | null)?.scrollIntoView?.({block: 'start', behavior: 'smooth'});
    });
    const element = (target: Face) => this.drawn(target);
    this.stickyLine = {
      get line() {
        return element(sticky.line);
      },
    };
    this.syncStickyLine();
    const observation = this.observation;
    if ('IntersectionObserver' in globalThis && observation) {
      this.stickyObserver = new IntersectionObserver(entries => {
        const last = entries[entries.length - 1];
        this.run(() => {
          setAttr(sticky.line, 'data-shown', String(!last?.isIntersecting));
        });
      });
      this.stickyObserver.observe(observation);
    }
    if (!this.stickyMutations && 'MutationObserver' in globalThis) {
      this.stickyMutations = new MutationObserver(records => {
        const line = this.screen.sticky ? this.elements.get(this.screen.sticky.line.id) : undefined;
        if (records.every(record => line?.contains(record.target))) return;
        if (this.stickyFrame) return;
        this.stickyFrame = requestAnimationFrame(() => {
          this.stickyFrame = 0;
          this.run(() => {
            this.syncStickyLine();
          });
        });
      });
      this.stickyMutations.observe(this.content, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['disabled', 'hidden'],
      });
    }
  }

  private stickyPrimaryTarget(): Face | null {
    for (const item of this.screen.hero?.transport ?? []) {
      const target = this.itemFace(item);
      if (target && !target.hidden && attr(target, 'data-kit-variant') !== 'destructive') return target;
    }
    return null;
  }

  private syncStickyLine(): void {
    const sticky = this.screen.sticky;
    if (!sticky) return;
    const observation = this.observation;
    setAttr(sticky.title, 'data-text', observation?.querySelector('.pv-resource-value')?.textContent.trim() || '');
    setAttr(sticky.sub, 'data-text', observation?.querySelector('.pv-content>.pv-meta')?.textContent.trim() || '');
    const target = this.stickyPrimaryTarget();
    setHidden(sticky.primary, !target);
    if (target) {
      const label =
        target === this.screen.submit?.face
          ? this.screen.submit.label
          : (Object.values(this.screen.actions).find(button => button.face === target)?.label ?? '');
      setAttr(sticky.primary, 'data-text', label.trim());
      setAttr(sticky.primary, 'data-disabled', String(target.disabled));
    }
    setHidden(sticky.more, !this.baseDisclosure);
  }

  private compactActiveActions(): void {
    const hero = this.screen.hero;
    if (!hero || !['cleaning', 'paused'].includes(this.value?.device?.status ?? '')) return;
    const home = hero.transport.find(item => {
      const target = this.itemFace(item);
      return item.kind === 'action' && !!target && attr(target, 'data-action-id') === 'return';
    });
    if (home?.kind !== 'action') return;
    hero.transport = hero.transport.filter(item => item !== home);
    const base = this.baseActions();
    base.items = [home.key, ...base.items];
    touch();
  }

  private buildMapSelector(mapName: unknown): MapPart {
    const name = typeof mapName === 'string' ? mapName : '';
    const option = robotControlGroups(this.value?.task).settings.find(
      row =>
        row.argsSchema.kind === 'choice' &&
        (row.argsSchema.choices ?? []).length > 0 &&
        (['map', 'map_id', 'active_map', 'selected_map'].includes(row.settingKey ?? '') ||
          /^(Kort|Etage)$/.test(row.label)),
    );
    if (!option) {
      if (mapName || activeJob(this.value?.device)) {
        const label = made('p', name, 'pv-meta robot-map-meta');
        label.hidden = !mapName;
        if (activeJob(this.value?.device)) this.faces.currentMap = label;
        return {kind: 'meta', face: label};
      }
      return null;
    }
    const select = made('select', undefined, 'robot-map-select'),
      placeholder = made('option', name || 'Vælg etage');
    setAttr(placeholder, 'value', '');
    placeholder.disabled = true;
    setAttr(select, 'data-choice-variant', 'navigation');
    setAttr(select, 'aria-label', option.label);
    setAttr(select, 'data-control-option-id', option.id);
    const choices = option.argsSchema.choices ?? [];
    const rows = choices.map(choice => {
      const row = made('option', choice.label);
      setAttr(row, 'value', choice.id);
      return row;
    });
    const part: MapSelect = {kind: 'select', face: select, placeholder, options: rows, value: ''};
    const paint = () => {
      const current = settingCurrent(this.value, option),
        matches = choices.filter(choice => choice.label === name),
        selected = choices.some(choice => choice.id === current)
          ? (current as string)
          : matches.length === 1
            ? (matches[0]?.id ?? '')
            : '';
      if (part.value !== selected) {
        part.value = selected;
        touch();
      }
      this.applySelect(part);
    };
    this.listen(select, 'change', event => {
      this.run(() => {
        const node = event.currentTarget as HTMLSelectElement;
        const chosen = node.value;
        paint();
        if (!node.disabled && choices.some(choice => choice.id === chosen)) this.action(option, {choiceId: chosen});
      });
    });
    const element = (target: Face) => this.drawn(target);
    this.mapControl = {
      option,
      get select() {
        return element(select) as HTMLSelectElement;
      },
      paint: () => {
        this.run(paint);
      },
    };
    paint();
    return part;
  }

  compactRepeat(rail: RailHandle): RailHandle {
    setAttr(rail.model.node, 'data-kit-size', 'compact');
    addClasses(rail.model.node, 'robot-repeat-choice');
    return rail;
  }

  confirmAction(option: RobotOption, opener?: Element | null): void {
    this.run(() => {
      const value = this.value ?? {},
        task = value.task,
        device = value.device,
        dialog = this.screen.dialog;
      if (!dialog || !['stop', 'return'].includes(option.action) || value.connected === false || device?.stale)
        return;
      if (option.direct) {
        if (value.directBlocked || foreignRobotPending(value) || !value.directActions?.includes(option.action)) return;
      } else if (
        this._disabled ||
        !task?.options.includes(option) ||
        value.pendingOptionId ||
        device?.pending ||
        expiredOffer(task)
      )
        return;
      const target = dialog.face;
      if (option.direct) setAttr(target, 'data-direct-action', option.action);
      else removeAttr(target, 'data-direct-action');
      const back = option.action === 'return';
      const titleId = `robot-confirm-${String(++cleaningSerial)}`;
      const cancel = made('button', 'Behold turen', 'pv-button'),
        accept = made('button', back ? 'Kør til basen' : 'Afslut rengøring', 'pv-button pv-primary');
      setAttr(cancel, 'type', 'button');
      setAttr(accept, 'type', 'button');
      setAttr(cancel, 'data-local-draft', 'true');
      setAttr(accept, 'data-control-option-id', option.id);
      if (option.direct) {
        setAttr(accept, 'data-direct-robot', 'true');
        setAttr(accept, 'data-action-id', option.action);
      }
      if (option.action === 'stop') kit(accept, 'button', {identity: 'robot', variant: 'primary', tone: 'danger'});
      dialog.confirm = {
        key: titleId,
        titleId,
        title: back ? 'Kør til basen?' : 'Afslut rengøringen?',
        copy: back
          ? 'Robotten sendes til basen.'
          : 'Rengøringen afsluttes. Robotten sendes ikke til basen. Brug Pause, hvis du vil fortsætte senere.',
        cancel,
        accept,
        acceptIcon: `assets/icons/${back ? 'arrow-u-down-left' : 'x-lg'}.svg`,
        acceptLabel: accept.text,
      };
      setAttr(target, 'aria-labelledby', titleId);
      setAttr(target, 'aria-describedby', `${titleId}-description`);
      kit(target, 'dialog', {variant: 'default'});
      touch();
      const node = () => this.elements.get(target.id) as HTMLDialogElement | undefined;
      this.listen(cancel, 'click', () => {
        node()?.close();
      });
      this.listen(accept, 'click', () => {
        this.run(() => {
          const element = node();
          if (!element?.open || accept.disabled || (!option.direct && this._disabled)) return;
          element.close();
          this.action(option);
        });
      });
      this.confirmationOpener = opener ?? document.activeElement;
      this.syncDisabledNow();
      this.paint();
      const element = node();
      if (element && !element.open) element.showModal();
      (this.element(cancel) as HTMLButtonElement | null)?.focus();
    });
  }
}

if ('customElements' in globalThis && !customElements.get('pv-robot-control-panel'))
  customElements.define('pv-robot-control-panel', RobotControlPanel);
