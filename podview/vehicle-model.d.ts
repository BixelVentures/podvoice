// Types for the pre-React vehicle model used by src/screens/vehicle.
export interface VehicleClimate {
  status: string | null;
  temperatureC?: number | null;
  targetTemperatureC?: number | null;
  minTemperatureC?: number | null;
  maxTemperatureC?: number | null;
  temperatureStepC?: number | null;
  defrost?: boolean | null;
  driverSeatHeat?: string | null;
  passengerSeatHeat?: string | null;
  seats?: {driver: number; passenger: number};
}

export interface VehicleCharging {
  status: string | null;
  powerKw?: number | null;
  endsAt?: number | null;
  limitPercent?: number;
}

export interface VehicleModel {
  kind?: string;
  mode: 'unconnected' | 'fixture' | 'observed';
  title: string;
  context: string;
  modelName: string | null;
  modelYear: number | null;
  status: string;
  shortStatus?: string;
  parked: boolean | null;
  locked: boolean | null;
  batteryPercent: number | null;
  rangeKm: number | null;
  charging: VehicleCharging;
  climate: VehicleClimate;
  access?: {rearTrunk?: string | null};
  history: unknown[];
  source: string;
  actions: unknown[];
  revision?: number;
  controlsPreview?: boolean;
  stale?: boolean;
  historicalFields?: string[];
  fieldObservedAt?: Record<string, number>;
  observedAt?: number;
  connectionState?: string | null;
  connectionSince?: number | null;
  exampleOnly?: boolean;
}

export interface VehicleChargeContext {
  connected?: boolean;
  scope?: string;
  sourceScope?: string;
  readGranted?: boolean;
  visible?: boolean;
  suppress?: boolean;
}

export interface VehicleChargePresentation {
  scope: string;
  eligible: boolean;
  observedAt: number | undefined;
  percent: number | null | undefined;
  status: string | null | undefined;
  cancel: boolean;
  cue: boolean;
}

export const VEHICLE_ARTWORK: string;
export function unconnectedVehicleModel(): VehicleModel;
export function vehicleFixture(options?: {charging?: boolean; now?: number; controls?: boolean}): VehicleModel;
export function vehicleModel(value: unknown): VehicleModel;
export function vehicleUpdatedLabel(value: unknown, now?: Date): string;
export function vehicleChargeUpdate(
  previous: VehicleChargePresentation | null | undefined,
  model: unknown,
  context?: VehicleChargeContext,
): VehicleChargePresentation;
