// Types for the pre-React UI kit helpers used by src/.
export function applyKitTemplate<T extends Element>(node: T, kind: 'detail' | 'response'): T;
export function applyKitComponent<T extends Element>(node: T, type: string, options?: {variant?: string}): T;
export function revealKitItem(item: Element | null | undefined, viewport: Element | null | undefined): void;

export interface KitSliderModel {
  value: number | null;
  valueText?: string;
  scope?: string;
  disabled?: boolean;
  pending?: boolean;
  mixed?: boolean;
  editableWhilePending?: boolean;
}
export interface KitSliderParts {
  node: HTMLElement;
  label: HTMLLabelElement;
  description: HTMLElement;
  input: HTMLInputElement;
  output: HTMLOutputElement;
}
export interface KitSliderField<C> extends KitSliderParts {
  setModel: (model: KitSliderModel) => void;
  cancelDraft: () => void;
}
export function bindKitSliderField<C>(
  parts: KitSliderParts,
  options: {getContext?: () => C; onCommit?: (value: number, context: C | undefined) => void},
): KitSliderField<C>;
