// How a Svar answer is named and marked in lists and on its card: the family's Danish name and the domain icon.
import type {Answer} from '../../screens/answers/types';

export const answerCatalog: Readonly<Record<string, string>> = Object.freeze({
  comparison: 'Sammenligning',
  concise: 'Kort svar',
  choices: 'Valgmuligheder',
  chart: 'Datagraf',
  steps: 'Trin for trin',
  checklist: 'Tjekliste',
  'fact-card': 'Faktakort',
  'sourced-image': 'Billede med kilde',
  'answer-timeline': 'Tidslinje',
  'simple-diagram': 'Enkelt diagram',
});

// The answer's domain icon (assets/icons/<name>.svg), from its provenance and words.
export function answerDomainIcon(answer: Answer | null | undefined): string {
  if (answer?.transcriptSegment) return 'chat-circle';
  const facts = (answer?.content?.facts ?? []).map(fact => fact.label);
  const text = [answer?.title, answer?.content?.summary, ...facts].join(' ').toLocaleLowerCase('da-DK');
  if (answer?.provenance?.kind === 'ha_weather') return 'cloud-sun';
  if (/måne|moon/.test(text)) return 'moon';
  if (/temperatur|vejret|vejrudsigt/.test(text)) return 'cloud-sun';
  if (/timer|minutter|nedtælling/.test(text)) return 'timer';
  if (/lys|lampe/.test(text)) return 'lightbulb';
  if (/musik|sang/.test(text)) return 'music-note-beamed';
  return 'chat-circle';
}
