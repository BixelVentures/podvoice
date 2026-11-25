// Bil on HA: the PodVoice integration's podvoice.vehicle_panel_state (custom_components/podvoice/vehicle_control.py)
// names the household's Tesla Fleet cars from HA's registries and gives what each car last reported, every field
// with its own timestamp, plus the car's unresolved earlier requests. The integration pushes it over
// podvoice/vehicle_subscribe when one of the car's entities changes and after each command (lib/ha/pushed.ts); nothing
// is polled. A command is podvoice.vehicle_command, with the add-on's risk model kept
// by the integration: lock is sent at once; everything else (and any action meeting an earlier unresolved request)
// first answers with a confirmation, which the user confirms in the dialog within 15 s, and is then sent once. Locking
// needs no confirmation of the page's own (the owner's rule, DECISIONS §12): it is the safe direction.
// The car's own HA entity (lock, climate, cover, switch, select) is the proof; nothing is resent.
import {useQuery, useQueryClient} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {create} from 'zustand';
import type {CommandStore} from './commands';
import {commands as appCommands} from './commands';
import type {HassEntityState} from './hass';
import {usePushedState} from './pushed';
import type {PushedState} from './pushed';
import {haKeys, serviceResponse, watchDomains} from './transport';

watchDomains('lock', 'climate', 'cover');

export type VehicleAction =
  | 'lock'
  | 'unlock'
  | 'climateOn'
  | 'climateOff'
  | 'temperature'
  | 'defrostOn'
  | 'defrostOff'
  | 'driverSeatHeat'
  | 'passengerSeatHeat'
  | 'rearTrunkToggle';
export interface VehicleArgs {
  temperature?: number;
  option?: string;
  direction?: 'open' | 'close';
}

const finiteNumber = z.number().refine(Number.isFinite);
const seat = z.enum(['off', 'low', 'medium', 'high']);
const vehicleData = z.looseObject({
  batteryPercent: finiteNumber.optional(),
  rangeKm: finiteNumber.optional(),
  locked: z.boolean().optional(),
  trunk: z.enum(['open', 'closed']).optional(),
  charging: z
    .looseObject({
      status: z.enum(['starting', 'charging', 'stopped', 'complete', 'disconnected']).optional(),
      powerKw: finiteNumber.optional(),
      endsAt: finiteNumber.optional(),
    })
    .optional(),
  climate: z
    .looseObject({
      status: z.enum(['off', 'heat_cool']).optional(),
      temperatureC: finiteNumber.optional(),
      targetTemperatureC: finiteNumber.optional(),
      minTemperatureC: finiteNumber.optional(),
      maxTemperatureC: finiteNumber.optional(),
      defrost: z.boolean().optional(),
      driverSeatHeat: seat.optional(),
      passengerSeatHeat: seat.optional(),
    })
    .optional(),
});
export type VehicleData = z.infer<typeof vehicleData>;

const vehicleRow = z.looseObject({
  deviceId: z.string().max(128),
  name: z.string().max(120),
  // HA's device model (Tesla Fleet), e.g. »Model Y«: the old screen's artwork and context are for a known model only.
  modelName: z.string().max(80).optional(),
  status: z.enum(['observed', 'stale', 'unavailable']),
  observedAt: finiteNumber.nullable().optional(),
  entities: z.record(z.string(), z.string()).default({}),
  controls: z.array(z.string()).max(16).default([]),
  data: vehicleData.nullable().optional(),
  fieldObservedAt: z.record(z.string(), finiteNumber).default({}),
  connection: z
    .looseObject({state: z.enum(['online', 'asleep', 'offline']), since: finiteNumber.nullable().optional()})
    .optional(),
  temperatureRange: z.looseObject({min: finiteNumber, max: finiteNumber, step: finiteNumber}).optional(),
  risk: z
    .looseObject({
      revision: z.number().int(),
      unresolved: z.record(z.string(), z.array(z.string())),
      pending: z.boolean(),
    })
    .nullable()
    .optional(),
});
export type VehicleRow = z.infer<typeof vehicleRow>;
export const vehicleStateSchema = z.looseObject({vehicles: z.array(vehicleRow).max(8)});
export type VehicleState = z.infer<typeof vehicleStateSchema>;

export const vehicleKey = (generation: number) => [...haKeys.read, 'vehicle', generation] as const;

export const VEHICLE_STATE: PushedState<VehicleState> = {
  type: 'podvoice/vehicle_subscribe',
  service: 'vehicle_panel_state',
  key: vehicleKey,
  schema: vehicleStateSchema,
};

// Pushed by the integration when one of the car's entities changes or a command was answered (lib/ha/pushed.ts).
export function useVehicleState(generation: number) {
  return usePushedState(VEHICLE_STATE, generation);
}

// ---- Seneste hændelser: the car's recorded lock, trunk, climate and charging changes (podvoice.vehicle_history) ----

const historySchema = z.looseObject({
  status: z.enum(['observed', 'unavailable', 'unknown']),
  items: z
    .array(
      z.looseObject({
        at: finiteNumber,
        field: z.enum(['locked', 'trunk', 'climate', 'charging']),
        value: z.string().max(32),
      }),
    )
    .max(20)
    .default([]),
});
export type VehicleHistory = z.infer<typeof historySchema>;

export function useVehicleHistory(deviceId: string | null, generation: number) {
  return useQuery({
    queryKey: [...haKeys.read, 'vehicle-history', deviceId ?? '', generation],
    enabled: !!deviceId,
    staleTime: 2000,
    gcTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<VehicleHistory> => {
      const result = await serviceResponse(
        {domain: 'podvoice', service: 'vehicle_history', data: {device_id: deviceId ?? ''}, returnResponse: true},
        historySchema,
      );
      if (!result.ok) throw new Error(result.reason || result.outcome);
      return result.value;
    },
  });
}

// ---- The confirmation the integration asks for ------------------------------------------------------------------

const confirmationSchema = z.looseObject({
  token: z.string().regex(/^[a-f0-9]{32}$/),
  expiresAt: finiteNumber,
  action: z.string(),
  label: z.string().max(80),
  args: z.record(z.string(), z.unknown()).default({}),
  effects: z.array(z.tuple([z.string(), z.string()])).max(3).default([]),
  nativeWakePossible: z.boolean().default(true),
  priorUnresolved: z.record(z.string(), z.array(z.string())).default({}),
  requiresOverride: z.boolean().default(false),
});
export type VehicleConfirmation = z.infer<typeof confirmationSchema>;

const commandReply = z.looseObject({
  outcome: z.enum(['accepted', 'rejected', 'unknown', 'confirmation_required']),
  reason: z.string().max(64).optional(),
  vehicleError: z.string().max(32).optional(),
  confirmation: confirmationSchema.optional(),
});

export interface PendingConfirmation {
  deviceId: string;
  action: VehicleAction;
  args: VehicleArgs;
  confirmation: VehicleConfirmation;
  // performance.now() when it arrived: the dialog closes before the integration's 15 s run out.
  receivedAt: number;
}

export const useVehicleConfirm = create<{pending: PendingConfirmation | null}>(() => ({pending: null}));
export const CONFIRM_WINDOW_MS = 14_000;

// HA's explicit service error (the integration's closed code) in the old Bil screen's words.
export const ERROR_TEXTS: Record<string, string> = {
  access_denied: 'Home Assistant afviste adgangen til bilen.',
  missing_scope: 'Tesla-forbindelsen mangler tilladelse til kommandoer.',
  wake_failed: 'Bilen kunne ikke vækkes.',
  no_response: 'Bilen svarede ikke.',
  rate_limited: 'Tesla afviser flere kommandoer lige nu · prøv igen senere.',
  refused: 'Bilen afviste kommandoen.',
};
export const UNKNOWN_OUTCOME = 'Udfald ukendt · kontrollér bilen.';
export const PENDING_TEXT = 'Svar mangler · Kontrollér bilen før en ny kommando.';
export const SETUP_FAILED = 'Betjeningen kunne ikke hentes.';

const ROLE: Record<VehicleAction, string> = {
  lock: 'locked',
  unlock: 'locked',
  climateOn: 'climate',
  climateOff: 'climate',
  temperature: 'climate',
  defrostOn: 'defrost',
  defrostOff: 'defrost',
  driverSeatHeat: 'driverSeat',
  passengerSeatHeat: 'passengerSeat',
  rearTrunkToggle: 'trunk',
};
export const actionFamily = (action: VehicleAction) =>
  action === 'rearTrunkToggle' ? 'trunk' : action === 'lock' || action === 'unlock' ? 'lock' : 'climate';
export const vehicleWishKey = (deviceId: string, action: VehicleAction) =>
  `vehicle:${deviceId}:${actionFamily(action)}`;

// HA shows the action's effect on the car's own entity.
export function vehicleConfirms(action: VehicleAction, args: VehicleArgs) {
  return (entity: HassEntityState | null): boolean => {
    if (!entity) return false;
    const state = entity.state;
    switch (action) {
      case 'lock':
        return state === 'locked';
      case 'unlock':
        return state === 'unlocked';
      case 'climateOn':
        return !['off', 'unknown', 'unavailable'].includes(state);
      case 'climateOff':
        return state === 'off';
      case 'temperature':
        return entity.attributes.temperature === args.temperature;
      case 'defrostOn':
        return state === 'on';
      case 'defrostOff':
        return state === 'off';
      case 'driverSeatHeat':
      case 'passengerSeatHeat':
        return state === args.option;
      case 'rearTrunkToggle':
        return state === (args.direction === 'open' ? 'open' : 'closed');
    }
  };
}

const reasonText = (reason: string | undefined, vehicleError: string | undefined) =>
  vehicleError
    ? (ERROR_TEXTS[vehicleError] ?? ERROR_TEXTS.refused ?? '')
    : reason === 'command_pending'
      ? PENDING_TEXT
      : SETUP_FAILED;

export interface VehicleSend {
  car: Pick<VehicleRow, 'deviceId' | 'entities'>;
  action: VehicleAction;
  args?: VehicleArgs;
  confirmation?: VehicleConfirmation;
}

// One explicit tap (or the dialog's confirm) → one podvoice.vehicle_command. A confirmation answer opens the dialog
// and ends the wish (nothing was sent to the car); a confirmed send waits for the car's entity, up to a minute
// because HA may have to wake the car.
export function vehicleCommands(store: CommandStore = appCommands, client?: QueryClient) {
  return ({car, action, args = {}, confirmation}: VehicleSend) => {
    const key = vehicleWishKey(car.deviceId, action);
    const entityId = car.entities[ROLE[action]] ?? null;
    const data: Record<string, string | number | boolean | Record<string, string | number>> = {
      device_id: car.deviceId,
      action,
      args: {...args},
    };
    if (confirmation) {
      data.confirmation = confirmation.token;
      data.acknowledge_prior_unresolved = confirmation.requiresOverride;
    }
    const confirm = vehicleConfirms(action, args);
    store.send({
      key,
      entityId,
      value: {action, args},
      timeoutMs: 60_000,
      confirm,
      ...(entityId ? {observed: () => store.source.read(entityId)} : {}),
      call: async () => {
        const result = await serviceResponse(
          {domain: 'podvoice', service: 'vehicle_command', data, returnResponse: true},
          commandReply,
          store.source,
        );
        void client?.invalidateQueries({queryKey: [...haKeys.read, 'vehicle']});
        if (!result.ok) return result;
        const reply = result.value;
        if (reply.outcome === 'confirmation_required' && reply.confirmation) {
          useVehicleConfirm.setState({
            pending: {
              deviceId: car.deviceId,
              action,
              args,
              confirmation: reply.confirmation,
              receivedAt: globalThis.performance.now(),
            },
          });
          // Nothing reached the car: the tap's wish ends here; the dialog is the next step.
          store.settle(key, true);
          return {ok: true, response: reply};
        }
        if (reply.outcome === 'accepted') return {ok: true, response: reply};
        return {
          ok: false,
          outcome: reply.outcome === 'unknown' ? 'unknown' : 'rejected',
          reason: reasonText(reply.reason, reply.vehicleError),
        };
      },
    });
  };
}

export function useVehicleCommands() {
  const client = useQueryClient();
  return vehicleCommands(appCommands, client);
}
