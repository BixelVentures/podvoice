// Types for the pre-React scene model used by src/screens/robot and src/screens/answers.
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
