// Types for the pre-React answer content validation (visual-content.js), used by src/screens/answers.
import type {AnswerContent} from './src/screens/answers/types';

export const visualFamilies: string[];
export const answerFamilies: string[];
export const typedAnswerFamilies: string[];
export function validateTypedAnswerContent(family: string, raw: unknown,
  options?: {ownerReceiptIds?: string[]; allowConversation?: boolean}): AnswerContent;
