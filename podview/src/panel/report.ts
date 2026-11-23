// What goes wrong on the wall reaches HA's log: JS errors (window error, unhandledrejection), a screen or the root
// recovering from a render error, a watchdog remount and frame-meter summaries, through the integration's
// rate-limited websocket command podvoice/panel_report (custom_components/podvoice/panel_ws.py). The page limits
// itself too: the same message once a minute, at most a few a minute, a short queue while HA is away. A report never
// throws and never waits; it is best effort, and it carries no entity data or user details.
import type {HaTransport} from '../lib/ha/transport';
import {transport as appTransport} from '../lib/ha/transport';

export type ReportKind = 'error' | 'unhandledrejection' | 'boundary' | 'remount' | 'frames' | 'load';

export interface Report {
  kind: ReportKind;
  message: string;
  detail?: string;
}

export interface ReporterOptions {
  source?: HaTransport;
  // Context sent with every report: the bundle digest the wall runs and its room.
  context?: () => {bundle?: string; room?: string | null};
  now?: () => number;
  perMinute?: number;
  queueMax?: number;
}

const clip = (value: string, max: number) => value.slice(0, max);

export function createReporter({
  source = appTransport,
  context = () => ({}),
  now = () => Date.now(),
  perMinute = 6,
  queueMax = 20,
}: ReporterOptions = {}) {
  const queue: Report[] = [];
  const lastSent = new Map<string, number>();
  let sentAt: number[] = [];

  const deliver = (report: Report) => {
    const hass = source.current();
    if (!hass || !source.connected()) return false;
    const {bundle, room} = context();
    const message: Record<string, unknown> = {
      type: 'podvoice/panel_report',
      kind: report.kind,
      message: clip(report.message, 500) || report.kind,
    };
    if (report.detail) message.detail = clip(report.detail, 2000);
    if (bundle) message.bundle = clip(bundle, 64);
    if (room) message.room = clip(room, 128);
    try {
      void Promise.resolve(hass.callWS(message)).catch(() => undefined);
    } catch {
      return false;
    }
    return true;
  };

  const allowed = (report: Report) => {
    const at = now();
    const id = `${report.kind}\u0000${report.message}`;
    const last = lastSent.get(id);
    if (last !== undefined && at - last < 60_000) return false;
    sentAt = sentAt.filter(time => at - time < 60_000);
    if (sentAt.length >= perMinute) return false;
    sentAt.push(at);
    lastSent.set(id, at);
    if (lastSent.size > 200) lastSent.delete(lastSent.keys().next().value ?? '');
    return true;
  };

  return {
    report(report: Report) {
      if (!allowed(report)) return;
      if (deliver(report)) return;
      queue.push(report);
      if (queue.length > queueMax) queue.splice(0, queue.length - queueMax);
    },
    // Called when HA is back: what happened while it was away is sent now.
    flush() {
      while (queue.length) {
        const next = queue[0];
        if (!next || !deliver(next)) return;
        queue.shift();
      }
    },
    pending: () => queue.length,
  };
}

export type Reporter = ReturnType<typeof createReporter>;

function describe(value: unknown): {message: string; detail: string} {
  if (value instanceof Error) return {message: `${value.name}: ${value.message}`, detail: value.stack ?? ''};
  if (typeof value === 'string') return {message: value, detail: ''};
  try {
    const json = JSON.stringify(value) as string | undefined;
    return {message: json ?? typeof value, detail: ''};
  } catch {
    return {message: String(value), detail: ''};
  }
}

export function errorReport(kind: ReportKind, error: unknown, extra = ''): Report {
  const {message, detail} = describe(error);
  return {kind, message, detail: [extra, detail].filter(Boolean).join('\n')};
}

// The panel window's uncaught errors and unhandled promise rejections.
export function installErrorReporting(reporter: Reporter, win: Window = globalThis.window): () => void {
  const onError = (event: ErrorEvent) => {
    const where = event.filename ? `${event.filename}:${String(event.lineno)}:${String(event.colno)}` : '';
    reporter.report(errorReport('error', event.error ?? event.message, where));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reporter.report(errorReport('unhandledrejection', event.reason));
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  return () => {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection);
  };
}
