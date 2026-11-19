// Types for the typed answer model (typed-answer.js), used by src/screens/answers.
import type {Answer, AnswerContent, AnswerScene} from './src/screens/answers/types';

export function typedAnswerPresentation(answer: Answer | null | undefined): AnswerContent;
export interface TypedAnswerView {
  content: AnswerContent;
  busy: boolean;
  status: {data: Record<string, unknown>; hidden: boolean};
  intro: {text: string; hidden: boolean};
  retry: {hidden: boolean; disabled: boolean};
  component: {part: 'choices' | 'comparison' | 'chart' | 'guide' | 'checklist'; count?: string;
    data: Record<string, unknown>} | null;
  sources: {hidden: boolean};
  sourceList: Record<string, unknown>;
}
export function typedAnswerView(answer: Answer, scene: AnswerScene): TypedAnswerView | null;
