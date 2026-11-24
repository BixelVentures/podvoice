// Robot on HA: the PodVoice integration's podvoice.robot_panel_state (custom_components/podvoice/robot_control.py)
// names the household's vacuums from HA's entity registry, with the transport actions HA's own state and feature
// bits admit, and the Roborock sensors on the robot and its dock. HA pushes the vacuum entity itself (watched here),
// so its state is live; the rest is read on open, after every command, when the vacuum changes and every 5 s while
// it works (30 s otherwise). A command is podvoice.robot_command: sent once from the state the user saw, and the
// vacuum entity's next state is its proof.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import type {HassEntityState} from './hass';
import {haKeys, serviceResponse, watchDomains} from './transport';

watchDomains('vacuum', 'select');

const telemetryRow = z.looseObject({
  key: z.string().max(64),
  value: z.union([z.string().max(160), z.number(), z.boolean()]),
  unit: z.string().max(16).nullable().optional(),
  updatedAt: z.number(),
  stale: z.boolean().optional(),
});
export type RobotTelemetry = z.infer<typeof telemetryRow>;

const robotRow = z.looseObject({
  entityId: z.string().regex(/^vacuum\.[a-z0-9_]+$/),
  name: z.string().max(120),
  state: z.string().max(64),
  observedAt: z.number().nullable(),
  supportedFeatures: z.number().int().nullable(),
  actions: z.array(z.enum(['resume', 'pause', 'stop', 'return'])).max(4),
  telemetry: z.array(telemetryRow).max(32).default([]),
  job: z
    .looseObject({
      scope: z.enum(['all', 'selected']),
      segmentIds: z.array(z.number()).max(32),
      roomIds: z.array(z.number()).max(32),
      repeat: z.number().int(),
    })
    .optional(),
});
export type RobotRow = z.infer<typeof robotRow>;

export const robotStateSchema = z.looseObject({robots: z.array(robotRow).max(12)});
export type RobotState = z.infer<typeof robotStateSchema>;

export type RobotAction = 'resume' | 'pause' | 'stop' | 'return';

// The integration's (and the add-on's) transport table: an action needs its HA feature bit and one of these states.
// The screen offers from HA's live state with it; the integration checks the same again before it sends.
const TRANSPORT: readonly [RobotAction, number, readonly string[]][] = [
  ['resume', 8192, ['paused']],
  ['pause', 4, ['cleaning']],
  ['stop', 8, ['cleaning', 'paused', 'returning']],
  ['return', 16, ['cleaning', 'paused', 'idle']],
];
export function transportActions(state: string | null | undefined, features: number | null | undefined): RobotAction[] {
  if (typeof features !== 'number' || !Number.isInteger(features) || features < 0) return [];
  return TRANSPORT.filter(([, bit, states]) => (features & bit) !== 0 && states.includes(state ?? '')).map(
    ([action]) => action,
  );
}

export const robotKey = (generation: number) => [...haKeys.read, 'robot', generation] as const;
const WORKING = new Set(['cleaning', 'paused', 'returning']);

export function useRobotState(generation: number) {
  return useQuery({
    queryKey: robotKey(generation),
    staleTime: 2000,
    gcTime: 60_000,
    refetchInterval: query =>
      query.state.data?.robots.some(robot => WORKING.has(robot.state)) ? 5000 : 30_000,
    queryFn: async (): Promise<RobotState> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'robot_panel_state', data: {}, returnResponse: true},
        robotStateSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return result.value;
    },
  });
}

// What the vacuum shows once an action took effect.
export const ROBOT_EFFECT: Record<RobotAction, readonly string[]> = {
  pause: ['paused'],
  resume: ['cleaning'],
  stop: ['idle', 'docked', 'paused'],
  return: ['returning', 'docked'],
};

export const robotWishKey = (entityId: string) => `${entityId}:transport`;

// The integration's refusals, in the old Robot screen's words.
export const ROBOT_REASONS: Record<string, string> = {
  changed_observation: 'Du kan ikke ændre rengøringen her lige nu.',
  unsupported_action: 'Du kan ikke ændre rengøringen her lige nu.',
  state_unavailable: 'Robotten er ikke tilgængelig',
};

const commandReply = z.looseObject({
  outcome: z.enum(['accepted', 'rejected', 'unknown']),
  reason: z.string().optional(),
});

// One explicit tap → one podvoice.robot_command. The vacuum's next HA state is the proof; a refusal or an answer
// that never came is shown, never resent.
export function robotCommands(store: CommandStore = appCommands, client?: QueryClient) {
  type Robot = Pick<RobotRow, 'entityId' | 'supportedFeatures'>;
  return (robot: Robot, vacuum: HassEntityState | null, action: RobotAction) => {
    const expected = vacuum?.state ?? '';
    const features = robot.supportedFeatures ?? -1;
    store.send({
      key: robotWishKey(robot.entityId),
      entityId: robot.entityId,
      value: action,
      timeoutMs: 15_000,
      confirm: entity => !!entity && ROBOT_EFFECT[action].includes(entity.state),
      observed: () => store.source.read(robot.entityId),
      call: async () => {
        const result = await serviceResponse(
          {
            domain: 'podvoice',
            service: 'robot_command',
            data: {entity_id: robot.entityId, action, expected_state: expected, expected_features: features},
            returnResponse: true,
          },
          commandReply,
          store.source,
        );
        void client?.invalidateQueries({queryKey: [...haKeys.read, 'robot']});
        if (!result.ok) return result;
        if (result.value.outcome === 'accepted') return {ok: true, response: result.value};
        const reason = result.value.reason ?? 'rejected';
        return {
          ok: false,
          outcome: result.value.outcome === 'unknown' ? 'unknown' : 'rejected',
          reason: ROBOT_REASONS[reason] ?? reason,
        };
      },
    });
  };
}

export function useRobotCommands() {
  const client = useQueryClient();
  return robotCommands(appCommands, client);
}

// ---- Rooms, settings, recipes and the journal (podvoice.robot_cleaning_state; robot_cleaning.py) ------------------

const settingRow = z.looseObject({
  key: z.enum(['cleaning_mode', 'mop_intensity', 'mop_mode', 'suction', 'map']),
  entityId: z.string().regex(/^(?:select|vacuum)\.[a-z0-9_]+$/),
  options: z.array(z.string().max(128)).min(1).max(64),
  current: z.string().max(128).nullable(),
});
export type RobotSetting = z.infer<typeof settingRow>;
export type SettingKey = RobotSetting['key'];

const journalItem = z.looseObject({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  source: z.enum(['panel', 'addon']),
  recordedAt: z.number(),
  acceptedAt: z.number().nullable(),
  outcome: z.enum(['accepted', 'unknown']),
  mapName: z.string().max(128).nullable().optional(),
  areaIds: z.array(z.string().max(128)).min(1).max(32),
  areaNames: z.array(z.string().max(128).nullable()).max(32),
  repeat: z.number().int().min(1).max(3),
  settings: z.record(z.string(), z.string().max(128)),
  reusable: z.boolean(),
});
export type JournalItem = z.infer<typeof journalItem>;

export const cleaningSchema = z.looseObject({
  entityId: z.string(),
  status: z.enum(['observed', 'unknown']),
  state: z.string().max(64).optional(),
  revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  mapName: z.string().max(128).nullable().optional(),
  rooms: z.array(z.looseObject({id: z.string().max(128), name: z.string().max(128)})).max(32).default([]),
  repeat: z.looseObject({min: z.number().int(), max: z.number().int()}).default({min: 1, max: 1}),
  settings: z.array(settingRow).max(8).default([]),
  startable: z.boolean().default(false),
  reason: z.string().max(64).nullable().optional(),
  blocked: z.boolean().default(false),
  journal: z
    .looseObject({
      status: z.enum(['observed', 'unavailable']),
      addon: z.enum(['observed', 'unavailable', 'addon_unavailable', 'unreadable']),
      items: z.array(journalItem).max(12),
    })
    .default({status: 'unavailable', addon: 'unavailable', items: []}),
});
export type RobotCleaning = z.infer<typeof cleaningSchema>;

export const cleaningKey = (entityId: string, generation: number) =>
  [...haKeys.read, 'robot-cleaning', entityId, generation] as const;

// Read on open, after every command and when the vacuum's state changes (the screen asks); HA has no push for the
// area mapping, the add-on's journal or the panel's own.
export function useRobotCleaning(entityId: string | null, generation: number) {
  return useQuery({
    queryKey: cleaningKey(entityId ?? '', generation),
    enabled: !!entityId,
    staleTime: 2000,
    gcTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<RobotCleaning> => {
      const result = await serviceResponse(
        {
          domain: 'podvoice',
          service: 'robot_cleaning_state',
          data: {entity_id: entityId ?? ''},
          returnResponse: true,
        },
        cleaningSchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return result.value;
    },
  });
}

// The order the add-on applies settings in, and the order the old screen showed them (model.ts settingOrder).
export const SETTING_ORDER: readonly SettingKey[] = ['cleaning_mode', 'suction', 'mop_intensity', 'mop_mode'];

// The integration's refusals of a start or a setting, in the old Robot screen's and journal's words.
export const CLEANING_REASONS: Record<string, string> = {
  changed_observation: 'Du kan ikke ændre rengøringen her lige nu.',
  not_ready: 'Robotten er i gang med den forrige kommando · dine valg gemmes til næste start.',
  unknown_room: 'Dine tidligere valg kunne ikke genskabes. Vælg rum og indstillinger igen.',
  recipe_changed: 'Dine tidligere valg kunne ikke genskabes. Vælg rum og indstillinger igen.',
  unsupported_setting: 'De viste robotindstillinger kan ikke ændres i dette rengøringssetup.',
  unsupported_repeat: 'Du kan ikke ændre rengøringen her lige nu.',
  unsupported_action: 'Du kan ikke ændre rengøringen her lige nu.',
  previous_unknown: 'Tidligere start er uvis; kontrollér robotten, gentag ikke',
  journal_unavailable: 'Rengøringsjournalen kunne ikke gemmes; ingen ny start tilladt',
  setting_failed: 'Udfald ukendt · handlingen gentages ikke',
  state_unavailable: 'Robotten er ikke tilgængelig',
};

const cleaningReply = z.looseObject({
  outcome: z.enum(['accepted', 'rejected', 'unknown']),
  reason: z.string().max(64).optional(),
});

export interface StartRequest {
  areaIds: string[];
  repeat: number;
  settings: Partial<Record<SettingKey, string>>;
  recipeId?: string;
}

export const startWishKey = (entityId: string) => `${entityId}:start`;
export const settingWishKey = (entityId: string, key: SettingKey) => `${entityId}:setting:${key}`;

function readReply(result: Awaited<ReturnType<typeof serviceResponse<z.infer<typeof cleaningReply>>>>) {
  if (!result.ok) return result;
  if (result.value.outcome === 'accepted') return {ok: true as const, response: result.value};
  const reason = result.value.reason ?? 'rejected';
  return {
    ok: false as const,
    outcome: result.value.outcome === 'unknown' ? ('unknown' as const) : ('rejected' as const),
    reason: CLEANING_REASONS[reason] ?? reason,
  };
}

// One Start tap → one podvoice.robot_start from the offer the user saw; the vacuum cleaning is its proof.
export function robotStart(store: CommandStore = appCommands, client?: QueryClient) {
  return (cleaning: RobotCleaning, vacuum: HassEntityState | null, request: StartRequest) => {
    const entityId = cleaning.entityId;
    store.send({
      key: startWishKey(entityId),
      entityId,
      value: request,
      timeoutMs: 30_000,
      confirm: entity => entity?.state === 'cleaning',
      observed: () => store.source.read(entityId),
      call: async () => {
        const result = await serviceResponse(
          {
            domain: 'podvoice',
            service: 'robot_start',
            data: {
              entity_id: entityId,
              area_ids: request.areaIds,
              repeat: request.repeat,
              settings: Object.fromEntries(
                Object.entries(request.settings).filter((entry): entry is [string, string] => !!entry[1]),
              ),
              expected_state: vacuum?.state ?? cleaning.state ?? '',
              revision: cleaning.revision ?? '',
              ...(request.recipeId ? {recipe_id: request.recipeId} : {}),
            },
            returnResponse: true,
          },
          cleaningReply,
          store.source,
        );
        void client?.invalidateQueries({queryKey: [...haKeys.read]});
        return readReply(result);
      },
    });
  };
}

// One choice → one podvoice.robot_setting from the value the user saw; HA's select (or fan speed) is its proof.
export function robotSetting(store: CommandStore = appCommands, client?: QueryClient) {
  return (vacuumId: string, row: RobotSetting, value: string) => {
    const shows = (entity: HassEntityState | null) =>
      row.key === 'suction' ? entity?.attributes.fan_speed === value : entity?.state === value;
    store.send({
      key: settingWishKey(vacuumId, row.key),
      entityId: row.entityId,
      value,
      timeoutMs: 15_000,
      confirm: shows,
      observed: () => store.source.read(row.entityId),
      call: async () => {
        const result = await serviceResponse(
          {
            domain: 'podvoice',
            service: 'robot_setting',
            data: {
              entity_id: vacuumId,
              key: row.key,
              setting_entity_id: row.entityId,
              value,
              expected_current: row.current,
            },
            returnResponse: true,
          },
          cleaningReply,
          store.source,
        );
        void client?.invalidateQueries({queryKey: [...haKeys.read, 'robot-cleaning', vacuumId]});
        return readReply(result);
      },
    });
  };
}

export function useRobotCleaningCommands() {
  const client = useQueryClient();
  return {start: robotStart(appCommands, client), setting: robotSetting(appCommands, client)};
}
