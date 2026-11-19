// Types for the transport and volume painter used by src/.
export interface PlayerControlsModel {
  playing?: boolean | undefined;
  previous?: boolean | undefined;
  next?: boolean | undefined;
  toggle?: boolean | undefined;
  blocked?: boolean | undefined;
  volumeBlocked?: boolean | undefined;
  volume?: number | null | undefined;
  canVolume?: boolean | undefined;
  min?: number | undefined;
  max?: number | undefined;
  gesture?: Element | null | undefined;
  sourceKind?: string | undefined;
  loadingControlId?: string | null | undefined;
  pendingLabel?: string | null | undefined;
}
export function renderPlayerControls(host: unknown, model?: PlayerControlsModel): void;
