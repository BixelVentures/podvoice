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
export function deviceLabel(device: object): string;
export function robotDetailMetadata(device: unknown): string;
// Used by src/screens/answers: the local example activities.
export interface Activity {
  id: string;
  title: string;
  description: string;
  icon: string;
  minutes: number;
  materials: number;
  steps: string[];
}
export const ACTIVITIES: Activity[];
export function visibleActivities(answer: unknown): Activity[];
