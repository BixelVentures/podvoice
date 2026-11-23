// The live vehicle owner: one server setup per tap (a proposal the screen confirms when it must), then one action.
// Presentation-only client: tickets, scopes and effect owners stay server-side. Rules:
// - a setup is asked only while the vehicle page is in front, PodVoice is connected and the snapshot offers the
//   action; one operation at a time;
// - the setup's task is read at the wire (readVehicleTask) and must be for exactly this action and its arguments;
// - a task is spent once; an action sent with a changed scope, an expired or spent task is never sent;
// - a receipt after the scope changed is LATE; an unreadable receipt is UNKNOWN; nothing is ever resent.
// What the operation exposes (presentationCurrent, observationCurrent, waitForObservation) is what the screen may
// use to say the car's answer; an observation never grants a command.
import {isVehicleAction, readVehicleReceipt, readVehicleTask, vehicleActionArgs} from '../../lib/api/vehicle';
import type {VehicleConfirmation, VehicleTask} from '../../lib/api/vehicle';

export interface VehicleTransport {
  generation?: unknown;
  connected?: boolean;
  controlSetup: (domain: 'vehicle', target: {action: string; args: Record<string, unknown>}) => Promise<unknown>;
  controlAction: (task: VehicleTask, optionId: string, args: Record<string, unknown>) => Promise<unknown>;
  recordDiagnostic?: (stage: string, fields: Record<string, unknown>) => void;
}

export interface VehicleSnapshot {
  bootId?: unknown;
  roomId?: unknown;
  sessionId?: unknown;
  providerGeneration?: unknown;
  capabilities?: {controlSetup?: unknown; vehicleActions?: unknown; homeRead?: unknown} | null;
}

// What the live owner needs from the shell (registered once by the shell; the tests register their own).
export interface VehicleLivePort {
  transport: () => VehicleTransport | null | undefined;
  snapshot: () => VehicleSnapshot | null | undefined;
  // The configured vehicle the home read is bound to (state.vehicleBinding).
  binding: () => unknown;
  focus: () => string | undefined;
  // The page is attached (the shell element is connected).
  attached: () => boolean;
  // Re-read home after an accepted or unknown action (the car's answer arrives through it).
  loadHome: () => void;
  // The shared device journal: the bounded value an action asks for (vehicleJournalValue) and its pending row
  // (trackDeviceJournal('vehicle', …)). Diagnostics only; never consulted by a guard.
  journalValue: (action: string, args: Record<string, unknown>) => boolean | number | undefined;
  track: (
    operation: {action: string},
    requestId: string | undefined,
    requestedValue: boolean | number | undefined,
    resourceId: unknown,
    current: () => boolean,
  ) => void;
}

export interface VehicleOperation {
  exampleOnly?: boolean;
  presentationCurrent?: () => boolean;
  observationCurrent?: () => boolean;
  waitForObservation?: (callback: () => void) => (() => void) | null | undefined;
}

export interface VehicleProposal {
  confirmation: Partial<VehicleConfirmation> & {action: string};
  operation: VehicleOperation;
}

export interface VehicleSendResult {
  status?: string;
  error?: string | undefined;
  late?: boolean;
}

const has = (list: unknown, value: string) => Array.isArray(list) && list.includes(value);
// A woken Tesla can take 10–30 s, then report.
const OBSERVATION_WAIT_MS = 60000;

interface LiveOperation extends Required<Pick<VehicleOperation, 'presentationCurrent' | 'observationCurrent'>> {
  action: string;
  diagnostic: Record<string, unknown>;
  diagnosticTransport: VehicleTransport | null | undefined;
  requestedValue: boolean | number | undefined;
  resourceId: unknown;
  receiptCurrent: () => boolean;
  current: () => boolean;
  waitForObservation: (callback: () => void) => () => void;
  task?: VehicleTask;
}

export interface LiveVehicle {
  // A proposal for one action, or null (nothing was offered). `presented` is true while the screen that asked is
  // the one shown.
  prepare: (action: string, args: Record<string, unknown>, presented: () => boolean) => Promise<VehicleProposal | null>;
  send: (operation: VehicleOperation) => Promise<VehicleSendResult>;
  cancel: (operation?: VehicleOperation | null) => void;
  // The operation between setup and send (the shell cancels it when the page is left).
  readonly operation: VehicleOperation | null;
}

export function createLiveVehicle(port: VehicleLivePort): LiveVehicle {
  let pending: LiveOperation | null = null;
  const spent = new Map<string, number>();
  const journal = (transport: VehicleTransport | null | undefined, stage: string, fields: Record<string, unknown>) => {
    try {
      transport?.recordDiagnostic?.(stage, fields);
    } catch {
      // Diagnostics never own dispatch or presentation.
    }
  };
  const journalValue = (action: string, args: Record<string, unknown>) => {
    try {
      return port.journalValue(action, args);
    } catch {
      return undefined;
    }
  };
  const allowed = () =>
    port.transport()?.connected === true && has(port.snapshot()?.capabilities?.controlSetup, 'vehicle');

  const prepare: LiveVehicle['prepare'] = async (action, args, presented) => {
    const s = port.snapshot();
    const t = port.transport();
    const requestedValue = journalValue(action, args);
    const resourceId = port.binding();
    const diagnostic = {
      domain: 'vehicle',
      action,
      resourceId,
      ...(requestedValue !== undefined ? {requestedValue} : {}),
    };
    if (
      !presented() ||
      !isVehicleAction(action) ||
      port.focus() !== 'vehicle' ||
      !port.attached() ||
      !allowed() ||
      !has(s?.capabilities?.vehicleActions, action) ||
      pending ||
      !s ||
      !t
    ) {
      journal(t, 'control_intent', {...diagnostic, code: pending ? 'intent_pending' : 'capability_missing'});
      return null;
    }
    journal(t, 'control_intent', {...diagnostic, code: 'start'});
    const generation = t.generation;
    const scopeOf = (snapshot: VehicleSnapshot | null | undefined) =>
      JSON.stringify([snapshot?.bootId, snapshot?.roomId, has(snapshot?.capabilities?.homeRead, 'vehicle')]);
    const scope = scopeOf(s);
    const current = () => {
      const transport = port.transport();
      const snapshot = port.snapshot();
      return (
        port.attached() &&
        transport === t &&
        t.connected === true &&
        t.generation === generation &&
        allowed() &&
        has(snapshot?.capabilities?.vehicleActions, action) &&
        scopeOf(snapshot) === scope
      );
    };
    const presentationCurrent = () => {
      const binding = port.binding();
      const snapshot = port.snapshot();
      return (
        presented() &&
        snapshot?.bootId === s.bootId &&
        snapshot?.roomId === s.roomId &&
        (!binding || binding === resourceId)
      );
    };
    const receiptCurrent = () => presentationCurrent() && current();
    const observationCurrent = () =>
      receiptCurrent() &&
      has(s.capabilities?.homeRead, 'vehicle') &&
      has(port.snapshot()?.capabilities?.homeRead, 'vehicle') &&
      typeof resourceId === 'string' &&
      port.binding() === resourceId;
    const waitForObservation = (callback: () => void) => {
      const timer = setTimeout(callback, OBSERVATION_WAIT_MS);
      return () => {
        clearTimeout(timer);
      };
    };
    const operation: LiveOperation = {
      action,
      diagnostic,
      diagnosticTransport: t,
      requestedValue,
      resourceId,
      presentationCurrent,
      receiptCurrent,
      observationCurrent,
      waitForObservation,
      current: () => receiptCurrent() && port.focus() === 'vehicle',
    };
    pending = operation;
    journal(t, 'control_setup', {...diagnostic, code: 'start'});
    try {
      const raw = await t.controlSetup('vehicle', {action, args});
      if (pending !== operation || !operation.current()) throw Error('changed');
      const task = readVehicleTask(raw, port.snapshot() ?? {});
      if (
        !task ||
        task.options[0].action !== action ||
        JSON.stringify(task.confirmation.args) !== JSON.stringify(args) ||
        spent.has(task.taskId)
      ) {
        throw Error('invalid');
      }
      operation.task = task;
      journal(t, 'control_setup', {...diagnostic, code: 'ok'});
      return {confirmation: task.confirmation, operation};
    } catch {
      journal(t, 'control_setup', {...diagnostic, code: operation.current() ? 'setup_unavailable' : 'superseded'});
      if (pending === operation) pending = null;
      return null;
    }
  };

  const cancel: LiveVehicle['cancel'] = operation => {
    if (pending !== operation) return;
    if (pending) journal(pending.diagnosticTransport, 'control_intent', {...pending.diagnostic, code: 'cancelled'});
    pending = null;
  };

  const send: LiveVehicle['send'] = async given => {
    const operation = given as LiveOperation;
    if (pending !== operation || !operation.current() || !operation.task || spent.has(operation.task.taskId)) {
      journal(operation.diagnosticTransport, 'control_intent', {...operation.diagnostic, code: 'scope_changed'});
      if (pending === operation) pending = null;
      return {status: 'failed'};
    }
    const task = operation.task;
    const option = task.options[0];
    const args = vehicleActionArgs(task);
    if (!args) {
      journal(operation.diagnosticTransport, 'control_intent', {...operation.diagnostic, code: 'invalid_dto'});
      pending = null;
      return {status: 'failed'};
    }
    spent.set(task.taskId, task.expiresAt);
    let sent = false;
    try {
      if (!operation.current()) throw Error('changed');
      const transport = port.transport();
      if (!transport) throw Error('changed');
      sent = true;
      const receipt = readVehicleReceipt(await transport.controlAction(task, option.id, args));
      const late = pending !== operation || !operation.receiptCurrent();
      if (!late && receipt.status !== 'failed') {
        port.track(
          {action: operation.action},
          receipt.requestId,
          operation.requestedValue,
          operation.resourceId,
          operation.receiptCurrent,
        );
        port.loadHome();
      }
      return {status: receipt.status, late, ...(receipt.error ? {error: receipt.error} : {})};
    } catch {
      const late = pending !== operation || !operation.receiptCurrent();
      if (!late && sent) port.loadHome();
      return {status: sent ? 'unknown' : 'failed', late};
    } finally {
      if (pending === operation) pending = null;
    }
  };

  return {
    prepare,
    send,
    cancel,
    get operation() {
      return pending;
    },
  };
}
