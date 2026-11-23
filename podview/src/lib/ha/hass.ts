// The slice of Home Assistant's frontend `hass` object PodView reads. HA hands the panel a new `hass` on every
// change (ha-panel-custom → setProperties); entity state objects that did not change keep their identity, which is
// what the transport (transport.ts) uses to skip unrelated entities. Everything read from it is validated with zod
// and copied into plain objects of this realm (the panel runs in HA's iframe, `hass` belongs to the parent window).
import {z} from 'zod';

export interface HassEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HassArea {
  area_id: string;
  name: string;
}

export interface HassDevice {
  id: string;
  area_id?: string | null;
  name?: string | null;
  name_by_user?: string | null;
}

export interface HassEntityEntry {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  platform?: string;
  hidden?: boolean;
  entity_category?: string | null;
}

export interface HassServiceTarget {
  entity_id?: string | string[];
}

// home-assistant-js-websocket's message subscription (forecasts, the timer bridge).
export interface HassConnection {
  subscribeMessage?: (
    callback: (message: unknown) => void,
    message: Record<string, unknown>,
  ) => Promise<() => unknown>;
}

export interface Hass {
  states: Record<string, HassEntityState | undefined>;
  areas?: Record<string, HassArea | undefined>;
  devices?: Record<string, HassDevice | undefined>;
  entities?: Record<string, HassEntityEntry | undefined>;
  connected?: boolean;
  language?: string;
  connection?: HassConnection;
  callService: (
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: HassServiceTarget,
    notifyOnError?: boolean,
    returnResponse?: boolean,
  ) => Promise<unknown>;
  callWS: (message: Record<string, unknown>) => Promise<unknown>;
}

// The panel registration (custom_components/podvoice/panel.py) passes its config here.
export interface HassPanel {
  url_path?: string;
  config?: Record<string, unknown> | null;
}

export const entityStateSchema = z.object({
  entity_id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/),
  state: z.string().max(255),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string(),
  last_updated: z.string(),
});

// A validated copy of one entity state, or null when HA's object is not one.
export function readEntity(value: unknown): HassEntityState | null {
  const parsed = entityStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const domainOf = (entityId: string) => entityId.slice(0, entityId.indexOf('.'));
export const UNAVAILABLE = new Set(['unavailable', 'unknown']);
