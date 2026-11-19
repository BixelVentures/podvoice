// Types for the pre-React Home Assistant observation used by src/screens/light.
export interface ObservedLightItem {
  entityId: string;
  areaId: string;
  name: string;
  state: string;
  brightness: number | null;
  supportsBrightness: boolean;
}
export interface ScopedLightsObservation {
  status: string;
  sourceEpoch: string | null;
  scope: {areaId: string; areaName: string; bindingId: string; placementRevision: number; isOwnArea: boolean};
  items: ObservedLightItem[];
}
export function scopedLightsObservation(value: unknown): ScopedLightsObservation | null;
