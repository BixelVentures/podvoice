// Types for the pre-React scene model used by src/screens/light.
export interface SceneBinding {
  sessionId: unknown;
  taskId: unknown;
  revision: unknown;
}
export function binding(state: {sessionId?: unknown}, device: {id: unknown; revision?: unknown}): SceneBinding;
export interface LightSelection {
  kind: 'light' | 'home' | 'room';
  roomId: string;
  label: string;
  status: string;
}
export function lightSelection(device: unknown): LightSelection | null;
export function lightHomeRestoreAvailable(state: unknown, device: unknown): boolean;
