// Types for the pre-React radio model used by src/screens/radio.
export interface RadioStation {
  readonly id: string;
  readonly label: string;
}
export const stations: readonly RadioStation[];
export const ownerStationIds: readonly string[];
export function radioStation(id: unknown): RadioStation | null;
