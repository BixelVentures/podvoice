// Svar: what an answer card (<pv-answer>) shows. The card keeps one AnswerParts per element: every part it shows or
// hides, and the data each kit component (podview/ui/library) was last given. paintAnswer() applies one answer to it
// exactly as the pre-React answer-widget.js did, branch by branch: a part a branch does not touch keeps what it
// had, so a card that changes branch shows what it showed before. AnswerCard.tsx draws the parts; AnswerWidget.tsx
// is the element. No React here.
import {ACTIVITIES, visibleActivities} from '../../../scene-model.js';
import {typedAnswerView} from '../../../typed-answer.js';
import {answerFamilies} from '../../../visual-content.js';
import {weatherFactDisplay} from '../../../weather-fact-display.js';
import type {Answer, AnswerContent, AnswerScene} from './types';

export {typedAnswerPresentation} from '../../../typed-answer.js';

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

export function answerDomainIcon(answer: Answer | null | undefined): string {
  if (answer?.transcriptSegment) return 'chat-circle';
  const facts = (answer?.content?.facts ?? []).map(fact => fact.label);
  const text = [answer?.title, answer?.content?.summary, ...facts].join(' ').toLocaleLowerCase('da-DK');
  if (answer?.provenance?.kind === 'ha_weather' || answer?.weatherPresentation?.kind === 'local-weather')
    return 'cloud-sun';
  if (/måne|moon/.test(text)) return 'moon';
  if (/temperatur|vejret|vejrudsigt/.test(text)) return 'cloud-sun';
  if (/timer|minutter|nedtælling/.test(text)) return 'timer';
  if (/lys|lampe/.test(text)) return 'lightbulb';
  if (/musik|sang/.test(text)) return 'music-note-beamed';
  return 'chat-circle';
}

// One element of the card: hidden, disabled, inert (as of the last answer) and the data its kit component was
// last given (undefined: never given any).
export interface Part {
  hidden: boolean;
  disabled: boolean;
  inert: boolean;
  data: unknown;
}

export interface AnswerParts {
  // The heading target's data-customize (local example answers only).
  customize: string | null;
  title: string;
  // The observed time; the <time> exists from the first answer on.
  time: {text: string; hidden: boolean} | null;
  icon: string;
  dismiss: {hidden: boolean; returnLabel: boolean | null};
  meta: {hidden: boolean; text: string};
  back: Part;
  status: Part;
  intro: Part;
  choices: Part;
  choicesCount: string | null;
  comparison: Part;
  chart: Part;
  guide: Part;
  checklist: Part;
  retry: Part;
  retryText: string;
  actions: Part;
  followups: Part;
  startGuide: Part;
  sources: Part;
  sourceList: Part;
  // The »Se vejret« button exists from the first weather answer on; its label is the one it was last given.
  weather: Part | null;
  weatherText: string;
  // The visual component (pv-<kind>); a new key is a new element.
  visual: {kind: string; key: number; data: Record<string, unknown>} | null;
}

const part = (hidden = false): Part => ({hidden, disabled: false, inert: false, data: undefined});

// The card as it is built, before its first answer.
export function initialParts(): AnswerParts {
  return {
    customize: null,
    title: '',
    time: null,
    icon: 'chat-circle',
    dismiss: {hidden: true, returnLabel: null},
    meta: {hidden: true, text: ''},
    back: part(),
    status: part(),
    intro: part(),
    choices: part(),
    choicesCount: null,
    comparison: part(),
    chart: part(),
    guide: part(),
    checklist: part(),
    retry: part(true),
    retryText: 'Prøv igen',
    actions: part(),
    followups: part(),
    startGuide: part(),
    sources: part(),
    sourceList: part(),
    weather: null,
    weatherText: '',
    visual: null,
  };
}

// What the card remembers between answers.
export interface AnswerMemory {
  localContentAvailable: boolean;
  rendered: {id: string; kind: string} | null;
  visualSerial: number;
}

export const initialMemory = (): AnswerMemory => ({localContentAvailable: false, rendered: null, visualSerial: 0});

// What one answer changes on the element itself (its own attributes) and what the element must do natively.
export interface AnswerPaint {
  attributes: Record<string, string>;
  // The answer is another one (id or kind): open disclosures close and the measured body height is released.
  identityChanged: boolean;
}

type PartName = 'back' | 'status' | 'intro' | 'choices' | 'comparison' | 'chart' | 'guide' | 'checklist' | 'retry' |
  'actions' | 'followups' | 'startGuide' | 'sources';

const CONTENT: PartName[] = ['choices', 'comparison', 'chart', 'guide', 'checklist', 'back', 'actions', 'followups',
  'startGuide', 'sources'];
// The parts whose inert follows hidden after every answer (the old update()).
const INERT: (PartName | 'weather')[] = ['intro', 'choices', 'comparison', 'chart', 'guide', 'checklist', 'followups',
  'actions', 'status', 'retry', 'weather'];

function hide(parts: AnswerParts, names: PartName[]) {
  for (const name of names) parts[name].hidden = true;
}

function weatherButton(parts: AnswerParts): Part {
  parts.weather ??= part();
  return parts.weather;
}

const readStatus = (answer: Answer) => answer.readStatus || answer.status;

function extent(content: AnswerContent): string {
  const rows = content.facts ?? content.events ?? content.nodes ?? content.items ?? content.steps ?? [];
  let characters = (content.summary || '').length +
    (content.image?.caption || content.illustration?.caption || '').length;
  for (const row of rows) {
    for (const field of ['label', 'value', 'detail', 'text'] as const) {
      const value = row[field];
      if (typeof value === 'string') characters += value.length;
    }
    for (const value of row.values ?? []) if (typeof value === 'string') characters += value.length;
  }
  return characters > 650 || rows.length > 6 ? 'long' : 'short';
}

function observedTime(answer: Answer): string {
  if (!Number.isFinite(answer.observedAt)) return '';
  const at = new Date((answer.observedAt ?? 0) * 1000);
  return at.toLocaleTimeString('da-DK', {hour: '2-digit', minute: '2-digit'}).replace(':', '.');
}

// One answer onto the card's parts: the old renderAnswer(), with its five branches below.
export function paintAnswer(parts: AnswerParts, memory: AnswerMemory, scene: AnswerScene, answer: Answer,
  inAnswerHost: boolean): AnswerPaint {
  const previous = memory.rendered;
  const sameAnswer = previous !== null && previous.id === answer.id && previous.kind === answer.kind;
  if (!sameAnswer) memory.localContentAvailable = false;
  if (!answer.live && ['partial', 'ready', 'done'].includes(answer.status ?? '')) memory.localContentAvailable = true;
  memory.rendered = {id: answer.id, kind: answer.kind};
  const attributes: Record<string, string> = {};
  attributes['data-question-repeated'] = String(scene.focus === answer.id && inAnswerHost);
  const icon = answerDomainIcon(answer);
  attributes['data-answer-icon'] = icon;
  const time = observedTime(answer);
  parts.time = {text: time, hidden: !time};
  parts.icon = icon;
  const offline = answer.live ? answer.readConnected !== true : scene.connected === false;
  // An answer without a status reads "undefined", as the old dataset write did.
  attributes['data-answer-state'] = answer.historical === true ? 'ready' : offline ? 'offline'
    : String(readStatus(answer));
  const weatherDomain = answer.provenance?.kind === 'ha_weather' ||
    answer.weatherPresentation?.kind === 'local-weather' || (!answer.live && answer.kind === 'concise');
  attributes['data-answer-domain'] = weatherDomain ? 'weather' : 'answer';
  attributes['data-kit-identity'] = weatherDomain ? 'weather' : 'neutral';
  const identityChanged = !!previous && (previous.id !== answer.id || previous.kind !== answer.kind);
  if (identityChanged && previous.id !== answer.id) parts.visual = null;
  if (parts.weather) parts.weather.hidden = true;
  parts.customize = null;
  const busy = answer.historical !== true &&
    ['waiting', 'partial', 'loading', 'pending'].includes(readStatus(answer) ?? '');
  attributes['aria-busy'] = String(busy);
  attributes['data-answer-family'] = answer.kind;
  attributes['data-answer-extent'] = extent(answer.content ?? {});
  attributes['data-conclusion-density'] = (answer.content?.summary || '').length > 100 ? 'prose' : 'brief';
  attributes['data-has-conclusion'] = String(!!answer.content?.summary || answer.kind === 'concise');
  attributes['data-typed-live'] = 'false';
  parts.retryText = answer.live ? 'Hent igen' : 'Prøv igen';
  const review = answer.exampleOnly === true && !answer.live && !answer.historical ? answer.reviewPresentation : null;
  parts.dismiss = {hidden: true, returnLabel: review?.returnLabel !== 'hide'};
  const ai = answer.provenance?.kind === 'ai_explanation';
  parts.meta = {hidden: !ai, text: ai ? 'AI-forklaring' : parts.meta.text};
  if (answer.historical === true) {
    const stamp = Number.isFinite(answer.observedAt)
      ? new Date((answer.observedAt ?? 0) * 1000).toLocaleString('da-DK', {dateStyle: 'short', timeStyle: 'short'})
      : '';
    const text = ['Tidligere svar', stamp, ai ? 'AI-forklaring' : ''].filter(Boolean).join(' · ');
    parts.meta = {hidden: false, text};
  }
  if (review?.previousAnswer === true && scene.voicePreviewPhase === 'LISTENING')
    parts.meta = {hidden: false, text: 'Forrige svar'};
  const paint = {attributes, identityChanged};
  if (answerFamilies.includes(answer.kind)) paintVisual(parts, memory, scene, answer);
  else {
    parts.visual = null;
    if (answer.transcriptSegment) paintTranscript(parts, answer, attributes);
    else if (answer.live) paintTyped(parts, scene, answer, attributes);
    else if (answer.kind === 'concise') paintWeather(parts, memory, scene, answer);
    else paintActivities(parts, memory, scene, answer);
  }
  for (const name of INERT) {
    const node = name === 'weather' ? parts.weather : parts[name];
    if (node) node.inert = node.hidden;
  }
  return paint;
}

// The four visual families and sport/key points: one pv-<kind> component carries the answer.
function paintVisual(parts: AnswerParts, memory: AnswerMemory, scene: AnswerScene, answer: Answer) {
  const connected = answer.live ? answer.readConnected === true : scene.connected;
  parts.title = answer.title ?? '';
  hide(parts, [...CONTENT, 'intro', 'status']);
  if (parts.weather) parts.weather.hidden = true;
  if (parts.visual && parts.visual.kind !== answer.kind) parts.visual = null;
  const example = answer.exampleOnly === true && !answer.live;
  const status = answer.status === 'waiting' ? 'loading' : answer.status === 'partial' ? 'pending' : answer.status;
  const data: Record<string, unknown> = {
    contextTitle: answer.title,
    domainIcon: answerDomainIcon(answer),
    hideOfflineStatus: scene.connectionNoticeVisible === true,
    exampleOnly: example,
    weatherPresentation: example ? answer.weatherPresentation : undefined,
    historical: answer.historical === true,
    forecast: answer.kind === 'answer-timeline' && answer.provenance?.kind === 'ha_weather',
    state: answer.historical === true ? 'ready' : !connected ? 'offline' : answer.readStatus || status,
    ownerReceiptIds: answer.ownerReceiptIds ?? [],
    allowConversation: answer.provenance?.kind === 'ai_explanation',
    content: answer.status === 'waiting' ? undefined : weatherFactDisplay(answer),
  };
  parts.visual = parts.visual ? {...parts.visual, data} : {kind: answer.kind, key: ++memory.visualSerial, data};
  if (example && answer.weatherPresentation?.kind === 'local-weather' &&
    ['ready', 'partial', 'done'].includes(answer.status ?? '') && answer.historical !== true) {
    weatherButton(parts).hidden = false;
    parts.weatherText = 'Se vejret';
    parts.actions.hidden = false;
  }
  parts.retry.hidden = answer.historical === true || readStatus(answer) !== 'error';
  parts.retry.disabled = !connected;
  if (!parts.retry.hidden) parts.actions.hidden = false;
}

// A transcript segment from the history: the whole registered text, no sources or actions.
function paintTranscript(parts: AnswerParts, answer: Answer, attributes: Record<string, string>) {
  const segment = answer.transcriptSegment;
  if (!segment) return;
  attributes['data-answer-domain'] = 'answer';
  attributes['data-kit-identity'] = 'neutral';
  parts.title = 'Samtaleudskrift';
  hide(parts, [...CONTENT, 'status', 'retry']);
  parts.intro.hidden = false;
  parts.intro.data = {domainIcon: 'chat-circle', text: segment.text};
  const at = new Date(segment.ts * 1000).toLocaleString('da-DK', {dateStyle: 'short', timeStyle: 'short'});
  parts.meta = {hidden: false, text: `Registreret tale fra PodVoice · ${at} · Kan være ufuldstændig`};
}

// A live owner answer in one of the six typed shapes: read-only content and its source receipt (typed-answer.js).
export function paintTyped(parts: AnswerParts, scene: AnswerScene, answer: Answer,
  attributes: Record<string, string> = {}) {
  attributes['data-typed-live'] = 'true';
  parts.title = answer.title ?? '';
  hide(parts, [...CONTENT, 'intro', 'status']);
  if (parts.weather) parts.weather.hidden = true;
  const view = typedAnswerView(answer, scene);
  if (!view) {
    parts.status.data = {state: 'error', quietStatus: true, text: 'Denne visning kunne ikke læses.'};
    parts.status.hidden = false;
    parts.retry.hidden = true;
    return;
  }
  attributes['aria-busy'] = String(view.busy);
  parts.status.data = view.status.data;
  parts.status.hidden = view.status.hidden;
  parts.intro.data = {domainIcon: answerDomainIcon(answer), text: view.intro.text};
  parts.intro.hidden = view.intro.hidden;
  parts.retry.hidden = view.retry.hidden;
  parts.retry.disabled = view.retry.disabled;
  if (!parts.retry.hidden) parts.actions.hidden = false;
  const shown = view.component;
  if (shown) {
    parts[shown.part].hidden = false;
    parts[shown.part].data = shown.data;
    if (shown.count !== undefined) parts.choicesCount = shown.count;
  }
  parts.sources.hidden = view.sources.hidden;
  parts.sourceList.data = view.sourceList;
}

// The local example weather answer (preview only).
function paintWeather(parts: AnswerParts, memory: AnswerMemory, scene: AnswerScene, answer: Answer) {
  const useful = ['partial', 'ready', 'done'].includes(answer.status ?? '') ||
    (answer.status === 'interrupted' && memory.localContentAvailable);
  parts.title = answer.title ?? '';
  hide(parts, CONTENT);
  const status = scene.connected ? answer.status ?? '' : 'offline';
  const labels: Record<string, string> = {
    offline: memory.localContentAvailable ? 'Offline · seneste svar er bevaret.'
      : 'Offline · ingen gemte svaroplysninger.',
    error: 'Vejrudsigten kom ikke frem.',
    empty: 'Der er ingen vejrudsigt lige nu.',
    interrupted: 'Svaret blev afbrudt.',
  };
  const label = labels[status];
  parts.status.data = {state: status, quietStatus: true, text: label || ''};
  parts.status.hidden = !label || (status === 'offline' && scene.connectionNoticeVisible === true);
  parts.intro.hidden = !useful;
  parts.intro.data = {domainIcon: answerDomainIcon(answer),
    text: 'En let jakke er en god idé. Det er 15° nu og bliver køligere i aften.'};
  parts.retry.hidden = answer.historical === true || answer.status !== 'error';
  parts.retry.disabled = !scene.connected;
  if (!parts.weather) parts.weatherText = 'Se vejrudsigten';
  weatherButton(parts).hidden = !useful;
  parts.actions.hidden = !useful && parts.retry.hidden;
}

const ACTIVITY_STATUS: Record<string, string> = {
  offline: '',
  interrupted: 'Svaret blev afbrudt.',
  error: 'Svaret kom ikke frem. Prøv igen.',
  empty: 'Ingen forslag denne gang. Prøv en anden forespørgsel.',
  done: '',
  ready: '',
};

// The local example activities (preview only): choices, comparison, chart, steps and checklist.
function paintActivities(parts: AnswerParts, memory: AnswerMemory, scene: AnswerScene, answer: Answer) {
  parts.customize = answer.id;
  const chosen = ACTIVITIES.find(activity => activity.id === answer.selected);
  parts.title = answer.title ?? '';
  const status = scene.connected ? answer.status ?? '' : 'offline';
  const statuses: Record<string, string> = {...ACTIVITY_STATUS, offline: memory.localContentAvailable
    ? 'Offline · seneste svar er bevaret.' : 'Offline · ingen gemte svaroplysninger.'};
  const text = Object.hasOwn(statuses, status) ? statuses[status] : undefined;
  parts.status.data = {state: status, quietStatus: true, text};
  parts.status.hidden = !text || (status === 'offline' && scene.connectionNoticeVisible === true);
  parts.retry.hidden = answer.historical === true || answer.status !== 'error';
  parts.retry.disabled = !scene.connected;
  const useful = ['partial', 'ready', 'done'].includes(answer.status ?? '') ||
    (answer.status === 'interrupted' && memory.localContentAvailable);
  parts.back.hidden = true;
  parts.back.disabled = !scene.connected;
  const ready = ['ready', 'done'].includes(answer.status ?? '');
  const context = {sessionId: scene.sessionId, taskId: answer.id, revision: answer.revision};
  const common = {quietStatus: true, context,
    connected: scene.connected && answer.status !== 'interrupted',
    state: ready ? 'ready' : answer.status === 'interrupted' ? 'interrupted' : 'loading'};
  const concise = answer.filter === 'few' ? 'Et ark papir er nok. Fold et papirfly sammen ved bordet.'
    : answer.filter === 'quick' ? 'Fold papir eller tegn sammen. Begge passer til en kort pause ved bordet.'
      : 'Prøv en lille aktivitet ved bordet. Fold papir, tegn sammen, eller lav et kort.';
  parts.intro.data = {domainIcon: answerDomainIcon(answer),
    text: answer.kind === 'concise' ? concise : 'Tre aktiviteter ved bordet. Vælg det, der passer jer.'};
  parts.intro.hidden = !useful || ['choices', 'comparison', 'chart', 'steps', 'checklist'].includes(answer.kind);
  const shown: [PartName, boolean][] = [
    ['choices', ['choices', 'concise'].includes(answer.kind) && answer.status !== 'partial'],
    ['comparison', answer.kind === 'comparison' && answer.status !== 'partial'],
    ['chart', answer.kind === 'chart'],
    ['guide', answer.kind === 'steps'],
    ['checklist', answer.kind === 'checklist'],
    ['followups', ['comparison', 'choices', 'chart', 'concise'].includes(answer.kind)],
    ['startGuide', false],
  ];
  for (const [name, show] of shown) parts[name].hidden = !useful || !show;
  const activities = visibleActivities(answer);
  parts.choicesCount = String(activities.length);
  parts.choices.data = {...common, selected: answer.selected,
    items: activities.map(a => ({id: a.id, label: a.title, detail: a.description, icon: a.icon}))};
  parts.comparison.data = {...common, selectable: true, selected: answer.selected, caption: '',
    columns: [{key: 'title', label: 'Aktivitet'}, {key: 'minutes', label: 'Tid'},
      {key: 'materials', label: 'Materialer'}],
    items: activities.map(a => ({...a, minutes: `${String(a.minutes)} min`,
      materials: `${String(a.materials)} ${a.materials === 1 ? 'type' : 'typer'}`}))};
  parts.chart.data = {unit: 'typer', unitSingular: 'type',
    items: activities.map(a => ({id: a.id, label: a.title, value: a.materials}))};
  parts.guide.data = {...common, state: answer.status === 'done' ? 'complete' : common.state,
    steps: chosen?.steps ?? [], index: answer.step};
  parts.checklist.data = {...common, checked: answer.checked,
    items: [{id: 'paper', label: 'Papir'}, {id: 'colors', label: 'Farver'}, {id: 'glue', label: 'Lim'}]};
  parts.followups.data = {...common, selected: answer.filter, items: [{id: 'quick', label: 'Højst 20 min'},
    {id: 'few', label: 'Færre materialer'}, {id: 'all', label: 'Vis alle'}]};
  parts.sources.hidden = !useful;
  parts.actions.hidden = (!useful || answer.status === 'partial' || ['steps', 'checklist'].includes(answer.kind)) &&
    parts.retry.hidden;
  parts.startGuide.disabled = !scene.connected || !ready;
  parts.sourceList.data = {items: [{id: 'fixture-source', label: 'Forhåndsvisning', url: 'example-sources.html',
    scope: 'Planlagte aktiviteter og tider; ingen opslag fra hjemmet eller persondata.'}]};
}
