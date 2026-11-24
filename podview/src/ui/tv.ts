// Variants for PodView's components (tailwind-variants) and its class merger, both told PodView's
// tokens (styles/tokens.css) so `text-pv-label` is read as a size and `text-pv-ink` as a colour, and a later class
// wins over an earlier one of the same kind.
import {createTV, extendTailwindMerge} from 'tailwind-variants/config';
import type {ClassNameValue} from 'tailwind-variants/config';

const COLORS = [
  'transparent', 'current', 'white', 'black', 'pv-bg', 'pv-surface', 'pv-surface-2', 'pv-line', 'pv-ink', 'pv-ink-2',
  'pv-ink-3', 'pv-on-dark', 'pv-dark', 'pv-danger', 'pv-danger-tint', 'pv-warning', 'pv-warning-tint', 'pv-ok',
  'pv-on-danger', 'pv-topbar', 'pv-music', 'pv-radio', 'pv-recipe', 'pv-answer', 'pv-timer-accent', 'pv-weather',
  'pv-weather-strong', 'pv-weather-ink', 'pv-robot', 'pv-robot-strong', 'pv-robot-ink', 'pv-light', 'pv-light-strong',
  'pv-light-ink', 'pv-tesla', 'pv-tesla-strong', 'pv-tesla-ink', 'pv-scrim',
];
const theme = {
  color: COLORS,
  text: ['pv-meta', 'pv-body', 'pv-label', 'pv-title', 'pv-value', 'pv-hero', 'pv-clock'],
  font: ['pv', 'pv-mono'],
  'font-weight': ['pv-regular', 'pv-medium', 'pv-semibold'],
  spacing: ['pv-s1', 'pv-s2', 'pv-s3', 'pv-s4', 'pv-s5', 'pv-hit', 'pv-hit-min', 'pv-icon-s', 'pv-icon-m', 'pv-icon-l'],
  radius: ['pv-s', 'pv-l', 'pv-hero', 'pv-pill', 'pv-dialog'],
  shadow: ['pv'],
  ease: ['pv-out', 'pv-in', 'pv-inout', 'pv-spring-0', 'pv-spring-15'],
};

const mergeConfig = {extend: {theme}};
const merge = extendTailwindMerge(mergeConfig);

/** Joins class names; a later utility replaces an earlier one of the same kind. */
export const cx = (...classes: ClassNameValue[]) => merge(...classes);

export const tv = createTV({twMerge: merge});
export type {VariantProps} from 'tailwind-variants';
