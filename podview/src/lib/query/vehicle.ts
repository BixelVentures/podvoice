// The admitted vehicle observation in the query cache. Writer: the shell, from its home read (ingestVehicle, with the
// shell's own stale marks while the connection is lost). Reader: the vehicle state (screens/vehicle/state.ts). Only
// an admitted observation (lib/api/vehicle.ts) is kept; anything else is no car. The observation is kept as given
// (its admission travels with it), and an equal one keeps the same object, so an unchanged read notifies nobody.
import {isVehicleObservation} from '../api/vehicle';
import type {VehicleObservation} from '../api/vehicle';
import {queryClient} from './client';

export const vehicleKey = ['podvoice', 'vehicle'] as const;

// Equal observations (all their own keys, the admission included) are the same data.
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Reflect.ownKeys(a);
  return (
    keys.length === Reflect.ownKeys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && equal((a as Record<PropertyKey, unknown>)[key],
      (b as Record<PropertyKey, unknown>)[key]))
  );
}

function prepare(client: typeof queryClient) {
  if (client.getQueryDefaults(vehicleKey).structuralSharing) return;
  client.setQueryDefaults(vehicleKey, {
    structuralSharing: (previous: unknown, next: unknown) => (equal(previous, next) ? previous : next),
  });
}

export function ingestVehicle(value: unknown, client = queryClient): VehicleObservation | null {
  prepare(client);
  const observation = isVehicleObservation(value) ? value : null;
  client.setQueryData(vehicleKey, observation);
  return client.getQueryData<VehicleObservation | null>(vehicleKey) ?? null;
}

export const readVehicle = (client = queryClient) =>
  client.getQueryData<VehicleObservation | null>(vehicleKey) ?? null;
