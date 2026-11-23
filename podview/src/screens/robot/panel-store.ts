// Robot: one control panel's state (a Zustand store per panel). The host (the live device detail or the local preview)
// writes what it knows: the offer, the observed robot, the connection and its own pending command. The panel keeps
// the layout for the current offer and the user's unsent draft (rooms, repeat and the start settings, one draft per
// cleaning type), the confirmation and the »Mere« disclosure. Rules, unchanged from the pre-React panel:
// - Start and the room draft stay live while a robot command runs; a second Start gets a message, not a queue (S2).
// - Stale data, a lost connection or an expired offer lock the controls at once; an unknown outcome is never resent.
// - A renewed offer keeps the controls (and the draft) only when the owner attests a complete id bijection and the
//   content is otherwise unchanged; otherwise the panel is rebuilt and the draft restored only from the owner.
// - Values the user picks are local until Start; a frequent setting outside the form sends its exact choice at once.
import {createStore} from 'zustand/vanilla';
import type {StoreApi} from 'zustand/vanilla';
import {controlArgs} from '../../../control-model.js';
import {buildLayout, syncDirectTransport} from './layout';
import type {CleaningDef, Layout, RailDef, SettingDef, StartSettingDef} from './layout';
import {
  activeJob,
  cleaningMode,
  irrelevantSetting,
  mutateOffer,
  rebindMap,
  sameTaskContent,
  settingConcept,
} from './model';
import type {RobotDevice, RobotOption} from './model';
import {directConfirmationCurrent, expiredOffer, settingCurrent} from './value';
import {dailyMode} from './present';
import type {PanelValue} from './value';

export const NOT_RESTORED = 'Dine tidligere valg kunne ikke genskabes. Vælg rum og indstillinger igen.';
const SECOND_START = 'Robotten er i gang med den forrige kommando · dine valg gemmes til næste start.';

export interface CleaningDraft {
  areaIds: string[];
  repeat: number | null;
  settingChoices?: {settingId: string; choiceId: string}[];
}

export interface SavedModeDrafts {
  ok: boolean;
  items: {mode: string | undefined; settings: {key: string | undefined; label: string | null}[]; repeat: number}[];
}

export interface Suggestion {
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

interface ModeDraft {
  settings: Map<string, string | null>;
  // NaN when no repeat was chosen (the draft is then not restorable).
  repeat: number | null;
}

// The start form's unsent choices.
export interface Draft {
  rooms: string[];
  repeat: number | null;
  settings: Record<string, string | null>;
  modes: Map<string | null, ModeDraft>;
}

export interface Confirm {
  option: RobotOption;
  titleId: string;
}

export interface Dialog {
  // Bumped per build; a direct confirmation kept through a same-scope rebuild keeps its element.
  key: string;
  confirm: Confirm | null;
  open: boolean;
  direct: string | null;
}

// The receipt-like texts a recent setup left (the pre-React panel's detached proposal parts).
export interface Proposal {
  caption: string;
  button: string;
  unready: boolean;
}

export type FocusTarget = 'base' | 'cancel' | 'rooms' | 'opener';

export interface PanelState {
  value: PanelValue | undefined;
  disabled: boolean;
  layout: Layout | null;
  draft: Draft;
  dirty: boolean;
  applied: boolean;
  historyApplied: boolean;
  suggestion: Suggestion | null;
  proposalSignature: string | null;
  proposal: Proposal;
  draftFeedback: string | null;
  renewalDiagnostic: string | null;
  // Typed fields: whether the value may be sent.
  fieldReady: Record<string, boolean>;
  dialog: Dialog;
  baseOpen: boolean;
  baseMemory: boolean;
  // The live host's busy mark for its pending option until the panel's next own sync (showOptionBusy).
  hostBusy: string | null | undefined;
  focus: {target: FocusTarget; serial: number} | null;
  // Rails whose »Aktuel indstilling« note has appeared (it then stays, hidden when not needed).
  noted: string[];
}

export interface PanelPort {
  emit: (type: string, detail?: unknown) => void;
  connected: () => boolean;
  baseTriggerFocused: () => boolean;
}

let dialogSerial = 0,
  confirmSerial = 0,
  focusSerial = 0;

const emptyDraft = (): Draft => ({rooms: [], repeat: null, settings: {}, modes: new Map()});

export const cleaningOf = (layout: Layout | null): CleaningDef | null => {
  for (const section of layout?.sections ?? []) if (section.kind === 'cleaning') return section.cleaning;
  return null;
};

const startSettings = (state: PanelState): StartSettingDef[] => cleaningOf(state.layout)?.settings ?? [];
const modeSetting = (state: PanelState) => startSettings(state).find(row => row.concept === 'mode');

// The start setting's value as the user sees it (unset until chosen or offered).
export const selectedSetting = (state: PanelState, row: StartSettingDef): string | null =>
  Object.hasOwn(state.draft.settings, row.setting.id) ? (state.draft.settings[row.setting.id] ?? null) : null;

export const selectedMode = (state: PanelState): string | null => {
  const row = modeSetting(state);
  if (!row) return null;
  return cleaningMode(row.setting.choices.find(choice => choice.id === selectedSetting(state, row))?.label);
};

export function readCleaningDraft(state: PanelState): CleaningDraft | null {
  const cleaning = cleaningOf(state.layout);
  if (!cleaning) return null;
  const settings = startSettings(state);
  return {
    areaIds: cleaning.areas.filter(area => state.draft.rooms.includes(area.id)).map(area => area.id),
    repeat: state.draft.repeat,
    ...(settings.length
      ? {
          settingChoices: settings
            .filter(row => selectedSetting(state, row))
            .map(row => ({settingId: row.setting.id, choiceId: selectedSetting(state, row) ?? ''})),
        }
      : {}),
  };
}

// Saved alternatives contain only unambiguous native labels/setting keys. They are presentation drafts, never option
// IDs or command authority.
export function readModeDrafts(state: PanelState): SavedModeDrafts | null {
  if (!cleaningOf(state.layout)) return null;
  const rows = startSettings(state),
    mode = modeSetting(state),
    items: SavedModeDrafts['items'] = [];
  if (!mode) return {ok: state.draft.modes.size === 0, items: []};
  for (const [id, draft] of state.draft.modes) {
    const modes = mode.setting.choices.filter(choice => choice.id === id),
      label = modes[0]?.label;
    if (
      modes.length !== 1 ||
      mode.setting.choices.filter(choice => choice.label === label).length !== 1 ||
      !Number.isInteger(draft.repeat)
    )
      return {ok: false, items: []};
    const settings: {key: string | undefined; label: string | null}[] = [];
    for (const [settingId, choiceId] of draft.settings) {
      const controls = rows.filter(row => row.setting.id === settingId),
        control = controls[0],
        key = control?.setting.key;
      if (controls.length !== 1 || rows.filter(row => row.setting.key === key).length !== 1)
        return {ok: false, items: []};
      if (choiceId === null) {
        settings.push({key, label: null});
        continue;
      }
      const selected = control?.setting.choices.filter(choice => choice.id === choiceId) ?? [],
        choice = selected[0]?.label;
      if (selected.length !== 1 || control?.setting.choices.filter(row => row.label === choice).length !== 1)
        return {ok: false, items: []};
      settings.push({key, label: choice ?? null});
    }
    items.push({mode: label, settings, repeat: Number(draft.repeat)});
  }
  return {ok: true, items};
}

export const validHistoryDraft = (value: PanelValue | undefined, raw: unknown): CleaningDef['historyDraft'] => {
  const task = value?.task,
    starts = task?.options.filter(o => o.action === 'start' && o.argsSchema.kind === 'cleaning') ?? [];
  const draft = raw as {source?: unknown; optionId?: unknown; areaIds?: unknown; repeat?: unknown} | null;
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
    const args = controlArgs(task, draft.optionId as string, {areaIds: draft.areaIds, repeat: draft.repeat});
    return {areaIds: args.areaIds as string[], repeat: args.repeat};
  } catch {
    return null;
  }
};

export function validSuggestion(state: PanelState, value: unknown): Suggestion | null {
  const task = state.value?.task,
    row = value as Suggestion | null | undefined,
    cleaning = cleaningOf(state.layout);
  if (
    !row ||
    !task ||
    row.optionId !== (cleaning?.option.id ?? null) ||
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
      id => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id) || !(schema.areas ?? []).some(area => area.id === id),
    ) ||
    !Number.isInteger(row.repeat) ||
    row.repeat < (schema.repeat?.min ?? 0) ||
    row.repeat > (schema.repeat?.max ?? 0)
  )
    return null;
  return {...row, areaIds: [...(areas as string[])]};
}

// Which offered start settings the user still has to choose (a special or product-hidden current is not a choice).
export interface StartRowView {
  hidden: boolean;
  hiddenChoices: Set<string>;
  unavailable: boolean;
  special: string | null;
}

export type Store = StoreApi<PanelState & Actions>;

export interface Actions {
  receive: (value: PanelValue) => void;
  setDisabled: (value: boolean) => void;
  observed: (device: RobotDevice | null | undefined, context?: PanelValue) => void;
  suggest: (value: unknown) => boolean;
  applyCleaningDraft: (draft: DraftInput) => boolean | undefined;
  applyModeDrafts: (saved: SavedModeDrafts | null | undefined) => boolean | undefined;
  showOptionBusy: (optionId: string | null) => void;
  toggleRoom: (id: string) => void;
  toggleAll: () => void;
  chooseStart: (row: StartSettingDef, choice: string) => void;
  chooseRepeat: (value: number) => void;
  submitCleaning: () => void;
  act: (option: RobotOption | null | undefined, args?: Record<string, unknown>) => void;
  setFieldReady: (option: RobotOption, ready: boolean) => void;
  confirm: (option: RobotOption) => void;
  dialogClosed: () => void;
  closeDialog: () => void;
  acceptConfirm: () => void;
  toggleBase: () => void;
  focused: () => void;
  disconnected: () => void;
}

export interface DraftInput {
  areaIds?: unknown;
  repeat?: unknown;
  settingChoices?: unknown;
  settings?: unknown;
}

// The cleaning form's draft after an exact draft input (applyCleaningDraft), or null when it does not fit the offer.
function draftFrom(state: PanelState, input: DraftInput): Draft | null {
  const cleaning = cleaningOf(state.layout);
  if (!cleaning) return null;
  const areas = input.areaIds,
    repeat = input.repeat;
  if (
    !Array.isArray(areas) ||
    areas.some(id => !cleaning.areas.some(area => area.id === id)) ||
    typeof repeat !== 'number' ||
    !Number.isInteger(repeat) ||
    repeat < cleaning.repeat.min ||
    repeat > cleaning.repeat.max
  )
    return null;
  const settings = {...state.draft.settings};
  const byKey = input.settings as Record<string, unknown> | undefined;
  if (!input.settingChoices && byKey) {
    for (const row of cleaning.settings) {
      if (row.setting.key !== undefined && Object.hasOwn(byKey, row.setting.key)) {
        const chosen = byKey[row.setting.key];
        settings[row.setting.id] = row.setting.choices.some(choice => choice.id === chosen) ? (chosen as string) : null;
      }
    }
  }
  if (Array.isArray(input.settingChoices)) {
    const rows = input.settingChoices as {settingId?: unknown; choiceId?: unknown}[];
    for (const row of cleaning.settings) {
      const chosen = rows.find(choice => choice.settingId === row.setting.id);
      settings[row.setting.id] =
        chosen && row.setting.choices.some(choice => choice.id === chosen.choiceId)
          ? (chosen.choiceId as string)
          : null;
    }
  }
  const offered = cleaning.repeatRail.choices.some(choice => Number(choice.value) === repeat);
  return {
    ...state.draft,
    rooms: cleaning.areas.filter(area => (areas as unknown[]).includes(area.id)).map(area => area.id),
    repeat: offered ? repeat : null,
    settings,
  };
}

// A freshly built form: the offered current start settings, the lowest repeat, the history draft, the owner's
// not-restored notice and a room picked elsewhere (selectedAreaId).
function initialDraft(
  value: PanelValue,
  cleaning: CleaningDef | null,
): Pick<PanelState, 'draft' | 'dirty' | 'historyApplied'> {
  const draft = emptyDraft();
  let dirty = false,
    historyApplied = false;
  if (!cleaning) return {draft, dirty, historyApplied};
  for (const row of cleaning.settings) {
    const current = row.setting.current;
    const offered = row.setting.choices.some(choice => choice.id === current);
    draft.settings[row.setting.id] = offered ? (current ?? null) : null;
  }
  draft.repeat = cleaning.repeat.min;
  const offeredRepeat = (n: unknown) => cleaning.repeatRail.choices.some(choice => Number(choice.value) === n);
  if (cleaning.historyDraft) {
    draft.rooms = cleaning.areas.filter(a => cleaning.historyDraft?.areaIds.includes(a.id)).map(a => a.id);
    draft.repeat = offeredRepeat(cleaning.historyDraft.repeat) ? (cleaning.historyDraft.repeat as number) : null;
    dirty = true;
    historyApplied = true;
  }
  if (value.task?.draft?.status === 'not_restored') {
    for (const row of cleaning.settings) draft.settings[row.setting.id] = null;
    draft.repeat = null;
  }
  const area = value.selectedAreaId;
  if (!cleaning.historyDraft && cleaning.areas.some(row => row.id === area)) {
    draft.rooms = cleaning.areas.filter(row => row.id === area).map(row => row.id);
    dirty = true;
  }
  return {draft, dirty, historyApplied};
}

// What a renewed offer's attested id map changes in the layout's copied ids (the offer objects are remapped in place).
function rebindLayout(layout: Layout, map: Map<string, string>): Layout {
  const swap = (id: string) => map.get(id) ?? id;
  const rail = (row: RailDef): RailDef => ({
    ...row,
    choices: row.choices.map(choice => ({...choice, value: swap(choice.value)})),
    inputAttrs: Object.fromEntries(
      Object.entries(row.inputAttrs).map(([key, id]) =>
        ['data-control-option-id', 'data-setting-id'].includes(key) ? [key, swap(id)] : [key, id],
      ),
    ),
  });
  const controls = (row: SettingDef): SettingDef => ('rail' in row ? {...row, rail: rail(row.rail)} : row);
  return {
    ...layout,
    actions: Object.fromEntries(
      Object.entries(layout.actions).map(([key, action]) => [
        key,
        {
          ...action,
          attrs: {
            ...action.attrs,
            ...(action.attrs['data-control-option-id']
              ? {'data-control-option-id': swap(action.attrs['data-control-option-id'])}
              : {}),
          },
        },
      ]),
    ),
    sections: layout.sections.map(section => {
      if (section.kind === 'cleaning')
        return {
          ...section,
          cleaning: {
            ...section.cleaning,
            repeatRail: rail(section.cleaning.repeatRail),
            settings: section.cleaning.settings.map(row => ({...row, rail: rail(row.rail)})),
          },
          controls: section.controls
            ? {
                ...section.controls,
                mode: section.controls.mode.map(controls),
                typed: section.controls.typed.map(controls),
              }
            : null,
        };
      if (section.kind === 'settings-zone' || section.kind === 'current-settings')
        return {
          ...section,
          controls: {
            ...section.controls,
            mode: section.controls.mode.map(controls),
            typed: section.controls.typed.map(controls),
          },
        };
      return section;
    }),
  };
}

function rebindDraft(draft: Draft, map: Map<string, string>): Draft {
  const swap = (id: string) => map.get(id) ?? id;
  return {
    rooms: draft.rooms.map(swap),
    repeat: draft.repeat,
    settings: Object.fromEntries(
      Object.entries(draft.settings).map(([id, choice]) => [swap(id), choice === null ? null : swap(choice)]),
    ),
    modes: new Map(
      [...draft.modes].map(([key, mode]) => [
        key === null ? null : swap(key),
        {
          ...mode,
          settings: new Map([...mode.settings].map(([id, value]) => [swap(id), value === null ? null : swap(value)])),
        },
      ]),
    ),
  };
}

// The transport row keeps the current primary in front (pause while cleaning, resume while paused, else Start).
function frontPrimary(layout: Layout, value: PanelValue | undefined): Layout {
  const status = value?.device?.status,
    wanted = status === 'cleaning' ? 'pause' : status === 'paused' ? 'resume' : null;
  const commands = layout.transport.filter(item => item.kind !== 'base');
  const primary =
    commands.find(item => item.kind === 'action' && layout.actions[item.key]?.option.action === wanted) ??
    commands.find(item => item.kind === 'submit');
  if (!primary || layout.transport[0] === primary) return layout;
  return {...layout, transport: [primary, ...layout.transport.filter(item => item !== primary)]};
}

export function createPanelStore(port: PanelPort): Store {
  return createStore<PanelState & Actions>()((write, get) => {
    // Every change remembers the rails that needed their »Aktuel indstilling« note.
    const set = (patch: Partial<PanelState>) => {
      write(patch);
      const noted = notedRails(get());
      if (noted) write({noted});
    };
    const focus = (target: FocusTarget) => {
      set({focus: {target, serial: ++focusSerial}});
    };
    const emitAction = (detail: unknown) => {
      if (!get().disabled) port.emit('robot-control-action', detail);
    };
    // A change the user made in the start form: the draft is theirs now (dirty), the notice it replaces goes.
    const touched = (patch: Partial<PanelState>) => {
      set({
        ...patch,
        draftFeedback: null,
        dirty: true,
        applied: false,
        hostBusy: undefined,
        proposal: {...get().proposal, caption: 'Tilpassede valg', button: 'Brug seneste valg', unready: true},
      });
      set({proposal: {...get().proposal, unready: !validSuggestion(get(), get().suggestion)}});
      port.emit('robot-draft-changed');
    };

    const build = (value: PanelValue, keepConfirmation: boolean) => {
      const state = get();
      const layout = frontPrimary(
        buildLayout(value, (_task, raw) => validHistoryDraft(value, raw), keepConfirmation),
        value,
      );
      const cleaning = cleaningOf(layout);
      // The form first shows the offered current values (their notes appear), then the restored draft.
      write({layout, draft: initialDraft({}, cleaning).draft, noted: []});
      if (value.task?.draft?.status !== 'not_restored' || cleaning?.historyDraft)
        write({noted: notedRails(get()) ?? []});
      set({
        layout,
        ...initialDraft(value, cleaning),
        applied: false,
        suggestion: null,
        proposalSignature: null,
        proposal: {
          caption: cleaning?.historyDraft ? 'Dit tidligere rumvalg' : 'Seneste rumvalg',
          button: 'Brug seneste valg',
          unready: false,
        },
        fieldReady: {},
        dialog: keepConfirmation
          ? state.dialog
          : {key: `dialog-${String(++dialogSerial)}`, confirm: null, open: false, direct: null},
        baseOpen: false,
        hostBusy: undefined,
      });
    };

    return {
      value: undefined,
      disabled: false,
      layout: null,
      draft: emptyDraft(),
      dirty: false,
      applied: false,
      historyApplied: false,
      suggestion: null,
      proposalSignature: null,
      proposal: {caption: 'Seneste rumvalg', button: 'Brug seneste valg', unready: false},
      draftFeedback: null,
      renewalDiagnostic: null,
      fieldReady: {},
      dialog: {key: 'dialog-0', confirm: null, open: false, direct: null},
      baseOpen: false,
      baseMemory: false,
      hostBusy: undefined,
      focus: null,
      noted: [],

      receive: value => {
        const state = get(),
          before = state.value,
          previous = before?.task;
        const sameDevice = before?.device?.id === value.device?.id,
          sameContext =
            sameDevice &&
            !value.task?.historyDraft &&
            !value.selectedAreaId &&
            previous?.bootId === value.task?.bootId &&
            previous?.roomId === value.task?.roomId &&
            previous?.mapName === value.task?.mapName &&
            before?.localOnly === value.localOnly,
          draft = sameContext && state.dirty ? readCleaningDraft(state) : null,
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
        const sameConnectedRobot =
          sameDevice &&
          before?.localOnly === value.localOnly &&
          before?.connected !== false &&
          value.connected !== false;
        const sameRobotScope =
          sameConnectedRobot &&
          (samePresentationScope || sameTaskScope) &&
          !before?.device?.stale &&
          !value.device?.stale;
        const direct = state.dialog.open ? state.dialog.direct : null;
        const keepDirect = !!(
          direct &&
          sameConnectedRobot &&
          samePresentationScope &&
          before.device?.status === value.device?.status &&
          activeJob(before.device) === activeJob(value.device) &&
          (!before.device?.stale || (direct === 'return' && before.directReadGap === true)) &&
          directConfirmationCurrent(direct, value)
        );
        if (direct && !keepDirect) set({dialog: {...get().dialog, open: false}});
        const baseFocused = !!(sameRobotScope && state.layout?.base && port.baseTriggerFocused());
        const baseExpanded = sameRobotScope && (state.layout?.base ? state.baseOpen : state.baseMemory);
        set({baseMemory: baseExpanded});
        const map =
          sameContext &&
          before?.device?.status === value.device?.status &&
          activeJob(before?.device) === activeJob(value.device) &&
          before?.localOnly === value.localOnly
            ? rebindMap(retained, value.task)
            : null;
        const local = state.dirty ? readCleaningDraft(state) : null,
          restored = value.task?.draft,
          cleaningId = cleaningOf(state.layout)?.option.id ?? '',
          draftSafe =
            !state.dirty ||
            (!!local &&
              restored?.status === 'restored' &&
              restored.optionId === map?.get(cleaningId) &&
              JSON.stringify(restored.areaIds) === JSON.stringify(local.areaIds.map(id => map?.get(id))) &&
              restored.repeat === local.repeat &&
              JSON.stringify(restored.settingChoices) ===
                JSON.stringify(
                  (local.settingChoices ?? []).map(row => ({
                    settingId: map?.get(row.settingId),
                    choiceId: map?.get(row.choiceId),
                  })),
                ));
        const dialogOpen = get().dialog.open;
        let renewalDiagnostic: string | null = null;
        if (previous && value.task && previous.taskId !== value.task.taskId)
          renewalDiagnostic = sameTask
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
                      : dialogOpen
                        ? 'robot_rebind_dialog'
                        : 'robot_rebind_restored';
        let rebound = false;
        if (map && draftSafe && !dialogOpen && retained) {
          // An attested renewal: every control keeps its element and takes the new offer's identifiers.
          const current = get();
          set({
            draft: rebindDraft(current.draft, map),
            layout: current.layout ? rebindLayout(current.layout, map) : null,
          });
          mutateOffer(retained.options, map);
          rebound = true;
        }
        const admitted: PanelValue =
          (sameTask || rebound) && retained && value.task
            ? {...value, task: {...value.task, options: retained.options}}
            : value;
        let draftFeedback = get().draftFeedback;
        if (value.task?.draft?.status === 'not_restored') draftFeedback = NOT_RESTORED;
        else if (
          value.task?.draft?.status === 'restored' ||
          !sameDevice ||
          previous?.bootId !== value.task?.bootId ||
          previous?.roomId !== value.task?.roomId ||
          (value.task && !value.task.draft)
        )
          draftFeedback = null;
        set({value: admitted, renewalDiagnostic, draftFeedback, hostBusy: undefined});
        if (sameTask || rebound) {
          const layout = get().layout;
          if (layout) set({layout: frontPrimary(syncDirectTransport(layout, admitted), admitted)});
          return;
        }
        // A fresh offer may restore the active draft without attesting an in-place rebind. Preserve only same-owner
        // presentation alternatives; remap their labels to the new form's offered IDs after the draft is restored.
        const modeDrafts = sameRobotScope && draft ? readModeDrafts(get()) : null;
        build(admitted, keepDirect);
        const active = value.task?.draft?.status === 'restored' ? value.task.draft : !value.task?.draft ? draft : null;
        if (active && get().applyCleaningDraft(active)) {
          set({dirty: true});
          if (modeDrafts && (!modeDrafts.ok || modeDrafts.items.length)) get().applyModeDrafts(modeDrafts);
        }
        if (sameRobotScope && get().layout?.base) {
          set({baseOpen: baseExpanded});
          if (baseFocused) focus('base');
        }
      },

      setDisabled: disabled => {
        set({disabled, hostBusy: undefined});
      },

      observed: (device, context = {}) => {
        const state = get(),
          before = state.value ?? {},
          next: PanelValue = {...before, ...context, device},
          direct = state.dialog.open ? state.dialog.direct : null;
        if (
          direct &&
          (device?.id !== before.device?.id ||
            device?.status !== before.device?.status ||
            activeJob(device) !== activeJob(before.device) ||
            !directConfirmationCurrent(direct, next))
        )
          set({dialog: {...state.dialog, open: false}});
        const layout = state.layout ? frontPrimary(syncDirectTransport(state.layout, next), next) : null;
        set({value: next, layout, hostBusy: undefined});
      },

      suggest: value => {
        const state = get();
        if (!cleaningOf(state.layout) || !port.connected() || state.historyApplied) return false;
        const valid = !state.disabled && validSuggestion(state, value);
        if (!valid) {
          set({suggestion: null, proposalSignature: null});
          return false;
        }
        if (state.dirty) return false;
        const signature = JSON.stringify(valid);
        if (signature === state.proposalSignature) return true;
        set({proposalSignature: signature, suggestion: valid});
        get().applyCleaningDraft(valid);
        set({dirty: false, applied: true, proposal: {...get().proposal, caption: 'Seneste rumvalg'}});
        return true;
      },

      applyCleaningDraft: input => {
        const state = get();
        if (!cleaningOf(state.layout)) return undefined;
        const draft = draftFrom(state, input);
        if (!draft) return false;
        set({draft, hostBusy: undefined});
        return true;
      },

      applyModeDrafts: saved => {
        const state = get(),
          cleaning = cleaningOf(state.layout);
        if (!cleaning) return undefined;
        const notRestored = () => {
          set({draftFeedback: NOT_RESTORED});
        };
        if (!saved?.ok || !Array.isArray(saved.items)) {
          notRestored();
          return false;
        }
        const mode = modeSetting(state);
        if (!mode) {
          if (saved.items.length) {
            notRestored();
            return false;
          }
          return true;
        }
        const mapped = new Map<string | null, ModeDraft>();
        let complete = true;
        for (const draft of saved.items) {
          const modes = mode.setting.choices.filter(choice => choice.label === draft.mode);
          const first = modes[0];
          if (modes.length !== 1 || !first || mapped.has(first.id) || !Array.isArray(draft.settings)) {
            complete = false;
            continue;
          }
          const settings = new Map<string, string | null>(),
            seen = new Set<string>();
          for (const row of cleaning.settings) if (row !== mode) settings.set(row.setting.id, null);
          for (const raw of draft.settings as unknown[]) {
            const item = raw as {key?: unknown; label?: unknown} | null;
            if (!item || typeof item.key !== 'string' || seen.has(item.key)) {
              complete = false;
              continue;
            }
            seen.add(item.key);
            const rows = cleaning.settings.filter(row => row.setting.key === item.key && row !== mode),
              row = rows[0];
            if (rows.length !== 1 || !row) {
              complete = false;
              continue;
            }
            if (item.label === null) {
              settings.set(row.setting.id, null);
              continue;
            }
            const found = row.setting.choices.filter(choice => choice.label === item.label);
            if (found.length !== 1 || !found[0]) {
              complete = false;
              continue;
            }
            settings.set(row.setting.id, found[0].id);
          }
          if (cleaning.settings.some(row => row !== mode && !seen.has(row.setting.key ?? ''))) complete = false;
          const offered = cleaning.repeatRail.choices.some(choice => Number(choice.value) === draft.repeat);
          const repeat = offered ? draft.repeat : null;
          if (repeat === null) complete = false;
          mapped.set(first.id, {settings, repeat});
        }
        set({draft: {...get().draft, modes: mapped}});
        if (!complete) notRestored();
        return complete;
      },

      showOptionBusy: optionId => {
        set({hostBusy: optionId});
      },

      toggleRoom: id => {
        const rooms = get().draft.rooms;
        const next = rooms.includes(id) ? rooms.filter(row => row !== id) : [...rooms, id];
        touched({draft: {...get().draft, rooms: next}});
      },

      toggleAll: () => {
        const cleaning = cleaningOf(get().layout);
        if (!cleaning) return;
        const all = cleaning.areas.every(area => get().draft.rooms.includes(area.id));
        touched({draft: {...get().draft, rooms: all ? [] : cleaning.areas.map(area => area.id)}});
      },

      chooseStart: (row, choice) => {
        const state = get();
        if (row.concept !== 'mode') {
          touched({draft: {...state.draft, settings: {...state.draft.settings, [row.setting.id]: choice}}});
          return;
        }
        const current = selectedSetting(state, row);
        if (choice === current) {
          touched({});
          return;
        }
        const cleaning = cleaningOf(state.layout);
        if (!cleaning) return;
        const settings = {...state.draft.settings},
          modes = new Map(state.draft.modes);
        // Each mode owns its unsent draft. Values are only restored locally; no service command is sent when the
        // mode or its defaults are changed.
        modes.set(current, {
          settings: new Map(
            cleaning.settings
              .filter(other => other.concept !== 'mode')
              .map(other => [other.setting.id, settings[other.setting.id] ?? null]),
          ),
          // NaN when no repeat was chosen: that draft is then not restorable (readModeDrafts).
          repeat: state.draft.repeat ?? NaN,
        });
        const saved = modes.get(choice),
          mode = cleaningMode(row.setting.choices.find(item => item.id === choice)?.label);
        settings[row.setting.id] = choice;
        for (const other of cleaning.settings) {
          if (other.concept === 'mode') continue;
          const offered = (id: unknown) => other.setting.choices.some(item => item.id === id);
          if (saved?.settings.has(other.setting.id)) {
            const previous = saved.settings.get(other.setting.id);
            settings[other.setting.id] = offered(previous) ? (previous ?? null) : null;
            continue;
          }
          // Irrelevant fields remain a hidden, owner-offered transport prerequisite.
          if (irrelevantSetting(other.concept, mode)) {
            const kept = offered(settings[other.setting.id]) ? settings[other.setting.id] : other.setting.current;
            settings[other.setting.id] = offered(kept) ? (kept ?? null) : null;
            continue;
          }
          // Product presets are resolved only against the current owner's offered IDs.
          const presets: Record<string, string[]> = {
              suction: ['balanced', 'balanceret', 'normal'],
              water: ['medium', 'mellem', 'moderate', 'normal'],
              mop_mode: ['standard'],
            },
            labels = mode ? presets[other.concept] : null;
          const matches = labels
            ? other.setting.choices.filter(item => labels.includes(item.label.trim().toLocaleLowerCase('da-DK')))
            : [];
          settings[other.setting.id] = matches.length === 1 ? (matches[0]?.id ?? null) : null;
        }
        const offeredRepeats = cleaning.repeatRail.choices.map(item => Number(item.value));
        const repeat = saved
          ? offeredRepeats.includes(saved.repeat ?? NaN)
            ? saved.repeat
            : null
          : offeredRepeats.includes(1)
            ? 1
            : Math.min(...offeredRepeats);
        touched({draft: {...state.draft, settings, modes, repeat}});
      },

      chooseRepeat: value => {
        touched({draft: {...get().draft, repeat: value}});
      },

      submitCleaning: () => {
        const state = get(),
          cleaning = cleaningOf(state.layout);
        if (!cleaning) return;
        if (!readCleaningDraft(state)?.areaIds.length) {
          focus('rooms');
          return;
        }
        if (state.draft.repeat !== null && !startBlocked(state))
          get().act(cleaning.option, {...readCleaningDraft(state)});
      },

      act: (option, args = {}) => {
        const state = get(),
          value = state.value ?? {},
          task = value.task,
          device = value.device;
        if (option?.direct) {
          if (value.connected === false || device?.stale || !value.directActions?.includes(option.action)) return;
          port.emit('robot-direct-action', {action: option.action});
          return;
        }
        if (option?.action === 'start' && (value.pendingOptionId || device?.pending)) {
          // A second Start is not queued behind a running command; the user gets a concrete answer (S2).
          set({draftFeedback: SECOND_START});
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
          port.emit('robot-control-expired-start', {optionId: option.id});
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
        emitAction({optionId: option.id, args});
      },

      setFieldReady: (option, ready) => {
        set({fieldReady: {...get().fieldReady, [option.id]: ready}, hostBusy: undefined});
      },

      confirm: option => {
        const state = get(),
          value = state.value ?? {},
          task = value.task,
          device = value.device;
        if (!state.layout || !['stop', 'return'].includes(option.action) || value.connected === false || device?.stale)
          return;
        if (option.direct) {
          const foreign = !!(value.pendingOptionId || device?.pending) && !ownPending(value);
          if (value.directBlocked || foreign || !value.directActions?.includes(option.action)) return;
        } else if (
          state.disabled ||
          !task?.options.includes(option) ||
          value.pendingOptionId ||
          device?.pending ||
          expiredOffer(task)
        )
          return;
        set({
          dialog: {
            ...state.dialog,
            confirm: {option, titleId: `robot-confirm-${String(++confirmSerial)}`},
            open: true,
            direct: option.direct ? option.action : null,
          },
          hostBusy: undefined,
        });
        focus('cancel');
      },

      dialogClosed: () => {
        if (get().dialog.open) set({dialog: {...get().dialog, open: false}});
      },

      closeDialog: () => {
        set({dialog: {...get().dialog, open: false}});
      },

      acceptConfirm: () => {
        const state = get(),
          option = state.dialog.confirm?.option;
        if (!state.dialog.open || !option || (!option.direct && state.disabled)) return;
        set({dialog: {...state.dialog, open: false}});
        get().act(option);
      },

      toggleBase: () => {
        set({baseOpen: !get().baseOpen});
      },

      focused: () => {
        set({focus: null});
      },

      disconnected: () => {
        set({dialog: {...get().dialog, open: false}, baseMemory: false, baseOpen: false});
      },
    };
  });
}

const ownPending = (value: PanelValue): boolean =>
  !!value.pendingOptionId &&
  value.task?.domain === 'vacuum' &&
  value.task.options.some(option => option.id === value.pendingOptionId);

// A start setting the user still has to choose blocks Start: none chosen, or a visible one whose current value is
// special or hidden for the chosen type.
export function startRow(state: PanelState, row: StartSettingDef): StartRowView {
  const mode = selectedMode(state),
    selected = selectedSetting(state, row),
    hidden = !!selected && irrelevantSetting(row.concept, mode);
  const hiddenChoices = productHidden(row.descriptor, row.setting.choices, mode);
  const special = specialCurrent(row.descriptor, row.setting.choices, selected, hiddenChoices.has(selected ?? ''));
  return {hidden, hiddenChoices, unavailable: special !== null, special};
}

export const startBlocked = (state: PanelState): boolean =>
  startSettings(state).some(row => {
    const view = startRow(state, row);
    return !selectedSetting(state, row) || (!view.hidden && view.unavailable);
  });

// Product presentation narrows only source-offered choices for a known mode; this is not a hardware capability claim.
import {choiceLabel, specialSelection} from './model';
import type {RobotChoice, SettingLike} from './model';

export function productHidden(option: SettingLike, choices: RobotChoice[], mode: string | null): Set<string> {
  const concept = settingConcept(option),
    scoped = ['both', 'vacuum', 'mop'].includes(mode ?? '') && ['suction', 'mop_mode'].includes(concept),
    out = new Set<string>();
  if (!scoped) return out;
  for (const choice of choices) {
    const label = choiceLabel(option, choice).trim().toLocaleLowerCase('da-DK'),
      isMaxPlus = ['max_plus', 'max+', 'maks.+'].includes(label),
      isDeep = ['deep', 'deep_plus', 'deep+', 'dyb', 'dyb+', 'grundig', 'grundig+'].includes(label);
    if (
      (concept === 'suction' && mode === 'both' && isMaxPlus) ||
      (concept === 'mop_mode' && ['both', 'vacuum'].includes(mode ?? '') && isDeep)
    )
      out.add(choice.id);
  }
  return out;
}

// »Aktuel indstilling: …« for a current value that cannot be chosen here (a special level or a product-hidden one).
export function specialCurrent(
  option: SettingLike,
  choices: RobotChoice[],
  current: unknown,
  hiddenByProduct: boolean,
): string | null {
  const choice =
    specialSelection(option, choices, current) ??
    (hiddenByProduct ? choices.find(row => row.id === current) : undefined);
  return choice ? choiceLabel(option, choice) : null;
}

// The rails whose note is needed now and was not yet noted (null: nothing new).
function notedRails(state: PanelState): string[] | null {
  const add: string[] = [];
  for (const row of startSettings(state))
    if (startRow(state, row).special && !state.noted.includes(row.rail.id)) add.push(row.rail.id);
  const mode = dailyMode(state);
  for (const section of state.layout?.sections ?? []) {
    const controls = 'controls' in section ? section.controls : null;
    for (const row of [...(controls?.mode ?? []), ...(controls?.typed ?? [])]) {
      if (row.kind !== 'level' || state.noted.includes(row.rail.id)) continue;
      const choices = row.option.argsSchema.choices ?? [],
        current = settingCurrent(state.value, row.option),
        hidden = productHidden(row.option, choices, mode);
      if (specialCurrent(row.option, choices, current, hidden.has(String(current)))) add.push(row.rail.id);
    }
  }
  return add.length ? [...state.noted, ...add] : null;
}
