// Types for the frame meter (frame-meter.js) as TypeScript code uses it.
export interface FrameSessionSummary {
  kind?: string;
  frames?: number;
  over34?: number;
  maxFrameMs?: number | null;
  p95FrameMs?: number | null;
  [field: string]: unknown;
}
export function begin(kind: string): void;
export function end(): void;
export function moved(): void;
export function flushFrames(): boolean;
export function takeFrames(): FrameSessionSummary[];
