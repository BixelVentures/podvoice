// Types for the pre-React UI kit helpers used by src/.
export function applyKitTemplate<T extends Element>(node: T, kind: 'detail' | 'response'): T;
export interface KitComponentOptions {
  variant?: string;
  identity?: string;
  label?: string;
  selected?: boolean;
  feedback?: 'label' | 'progress';
  tone?: 'neutral' | 'warning' | 'danger';
  loading?: boolean;
}
export function applyKitComponent<T extends Element>(node: T, type: string, options?: KitComponentOptions): T;
export function applyKitTextRole<T extends Element>(node: T, role: string): T;
export function createKitComponent(
  type: string,
  options?: KitComponentOptions & {document?: Document; tag?: string; className?: string; text?: string},
): HTMLElement;
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

export function applyKitDialog<T extends Element>(
  node: T,
  parts?: {header?: Element | null; content?: Element | null; description?: Element | null;
    actions?: Element | null; close?: Element | null; variant?: string},
): T;
export function runKitButtonAction<R>(
  node: HTMLElement,
  action: () => R | Promise<R>,
  options?: {confirmed?: (result: R) => boolean},
): Promise<R | undefined>;
