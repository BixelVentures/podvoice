// Types for the motion primitives used by src/ (docs/MOTION.md).
export const SPRING: Readonly<Record<'quick' | 'smooth' | 'snappy' | 'flick', {duration: number; bounce: number}>>;
export function springCurve(spec: {duration: number; bounce?: number}): {easing: string; ms: number};
export function showValue(motion: unknown, node: Element | null, text: string, options?: {still?: number}): void;
export interface ProgressSource {
  source: 'none' | 'tick' | 'user';
  interval?: number;
}
export function showProgress(node: HTMLElement | null, property: string, value: string, source?: ProgressSource): void;
export function isReduced(node?: Element | null): boolean;
export const DUR: Readonly<Record<'tap' | 'quick' | 'base' | 'ambient' | 'reduced', number>>;
