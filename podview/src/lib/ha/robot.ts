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

watchDomains('vacuum');

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
