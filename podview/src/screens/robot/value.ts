// Robot: what a host hands the control panel (the live detail and the local preview), and the small rules that read
// it: the current value of a setting, whose command is pending, and when an offer has expired.
import type {RobotDevice, RobotOption, RobotTask} from './model';

export interface CurrentSetup {
  mapName?: unknown;
  repeat?: unknown;
  repeatRange?: {min?: unknown; max?: unknown} | undefined;
  areas?: unknown;
}

export interface PresentationScope {
  bootId?: unknown;
  roomId?: unknown;
  deviceId?: unknown;
  transport?: unknown;
  generation?: unknown;
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

export const settingCurrent = (value: PanelValue | undefined, option: RobotOption): unknown =>
  Object.hasOwn(value?.settingValues ?? {}, option.id) ? value?.settingValues?.[option.id] : option.argsSchema.current;

export const ownRobotPending = (value: PanelValue): boolean =>
  !!value.pendingOptionId &&
  value.task?.domain === 'vacuum' &&
  value.task.options.some(option => option.id === value.pendingOptionId);

export const foreignRobotPending = (value: PanelValue): boolean =>
  !!(value.pendingOptionId || value.device?.pending) && !ownRobotPending(value);

// A pending Pause/Fortsæt does not cancel an open confirmation; its tap is queued (S3).
export const directConfirmationCurrent = (action: string, value: PanelValue): boolean =>
  value.connected !== false &&
  !value.directBlocked &&
  !foreignRobotPending(value) &&
  (value.device?.stale ? action === 'return' && value.directReadGap === true : !!value.directActions?.includes(action));

export const expiredOffer = (task: RobotTask | null | undefined): boolean =>
  Number.isFinite(task?.expiresAt) && (task?.expiresAt ?? 0) * 1000 <= Date.now();
