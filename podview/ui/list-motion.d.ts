// Types for the P4 list motion (docs/MOTION.md) used by src/.
export function animateList(container: Element, mutate: () => void,
  options?: {items?: string; stagger?: number; track?: string; reduced?: boolean}): void;
