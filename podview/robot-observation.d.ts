// Types for the pre-React robot observation used by src/screens/robot.
export interface RobotExperience {
  jobActive?: boolean;
  activity: string | null;
  issues: unknown[];
}
export function robotExperience(device: unknown): RobotExperience;
export interface RobotFactRow {
  label: string;
  value: string;
  stale: boolean;
  group?: string;
}
export function robotFacts(device: unknown): {
  summary: string[];
  history: RobotFactRow[];
  attention: string[];
  details: RobotFactRow[];
};
export function robotRoom(device: unknown): string | null | undefined;
