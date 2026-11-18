// Types for the pre-React UI kit helpers used by src/.
export function applyKitTemplate<T extends Element>(node: T, kind: 'detail' | 'response'): T;
export function applyKitComponent<T extends Element>(node: T, type: string, options?: {variant?: string}): T;
