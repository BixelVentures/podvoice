// Fake HA services for the PodVoice add-on bridge (installed by createFakeHass): podvoice/answers_subscribe
// pushes (and podvoice.answers_snapshot answers) two saved answers in the add-on's closed history shape
// (podview.answer-history.v1). Their content is copied from the wall page's own saved examples
// (visual-examples.js: »Hvor langt er der til Månen?« and »En rolig morgen«), so nothing here is invented.
// `addonAnswers` lets a test or the browser journey switch the add-on's state.
import type {FakeHass} from '../ha-fixture';

export type AddonState = 'ready' | 'empty' | 'unavailable' | 'unknown_room';

const RECEIPTS = ['c'.repeat(32), 'd'.repeat(32)];
const example = (scope: string) => [
  {id: 'example', label: 'Om forhåndsvisningen', url: 'https://podvoice.example/forhaandsvisning', scope},
];
const EXAMPLES = [
  {
    family: 'fact-card',
    title: 'Hvor langt er der til Månen?',
    content: {
      summary: 'Afstanden varierer, fordi Månens bane ikke er en perfekt cirkel.',
      facts: [
        {id: 'average-distance', label: 'Gennemsnitlig afstand', value: '384.400 km',
          detail: 'Mellem Jorden og Månen. Gennemsnit, ikke afstanden lige nu.', sourceId: 'nasa-moon'},
      ],
      sources: [
        {
          id: 'nasa-moon',
          label: 'NASA · How Far Away Is the Moon?',
          url: 'https://spaceplace.nasa.gov/moon-distance/en/',
          scope:
            'Offentlig NASA-forklaring kontrolleret 15. oktober 2026. Gemt indhold, ikke et liveopslag fra PodVoice.',
        },
      ],
    },
  },
  {
    family: 'answer-timeline',
    title: 'En rolig morgen',
    content: {
      summary: 'Spis morgenmad først, og find tasker og overtøj, inden I går.',
      events: [
        {id: 'breakfast', time: '07.00', label: 'Morgenmad sammen', detail: 'Plads til en rolig start ved bordet.',
          status: 'planned', sourceId: 'example'},
        {id: 'ready', time: '07.25', label: 'Tasker og overtøj', detail: 'Find det, der skal med.', status: 'planned',
          sourceId: 'example'},
        {id: 'leave', time: '07.45', label: 'Ud ad døren', detail: 'Klar til dagens første tur.', status: 'planned',
          sourceId: 'example'},
      ],
      sources: example('En foreslået plan. Ingen kalender eller familiens aftaler er tilsluttet.'),
    },
  },
];

// Every other answer form (A-Svar's), each with the product's own saved example: the wall page's visual-examples.js
// (the lake, the bicycle's gears), scene-model.js ACTIVITIES (»En pause uden skærm«, »Fold papir«) and the result
// HA Green answered (El Clásico, 25. oktober 2026). `addonAnswers.forms` adds them to the history.
const activities = [
  {id: 'paper-fold', label: 'Fold papir', detail: 'Et ark papir og plads ved bordet.', minutes: 15, materials: 1},
  {id: 'draw-together', label: 'Tegn sammen', detail: 'Papir og farver. Skift til at tegne.', minutes: 20,
    materials: 2},
  {id: 'make-card', label: 'Lav et kort', detail: 'Papir, farver og lim til et lille kort.', minutes: 30, materials: 3},
];
const local = example('Lokalt aktivitetseksempel.');
const PAUSE = 'Tre aktiviteter ved bordet. Vælg det, der passer jer.';
export const FORM_EXAMPLES = [
  {family: 'sport-result', title: 'El Clásico', content: {summary: 'Real Madrid 2–1 Barcelona · 25. oktober 2026',
    match: {home: 'Real Madrid', away: 'Barcelona', homeScore: 2, awayScore: 1, date: '25. oktober 2026',
      competition: null}, scorers: [], sources: example('AI-forklaring fra PodVoice.')}},
  {family: 'sourced-image', title: 'En pause ved vandet', content: {
    summary: 'Søen ligger stille mellem bjergene i aftensolen.',
    image: {url: 'assets/lake.webp', alt: 'Illustration af en stille sø med bjerge og en rosa aftenhimmel.',
      caption: 'Farverne i himlen spejler sig i den rolige sø.', credit: 'PodView · AI-genereret illustration',
      kind: 'illustration', sourceId: 'example'},
    sources: example('Gemt AI-genereret illustration. Viser ikke et dokumenteret sted eller en aktuel hændelse.')}},
  {family: 'simple-diagram', title: 'Gear ændrer, hvor let du træder.', content: {
    summary: 'Et lavt gear gør det lettere at træde op ad bakke.',
    illustration: {url: 'assets/bicycle-drivetrain-illustration.webp',
      alt: 'AI-illustration af cyklens baghjul, kæde og pedaler, set fra siden.',
      caption: 'AI-genereret illustration · principskitse, ikke en teknisk tegning.',
      credit: 'PodView · AI-genereret illustration', kind: 'illustration', sourceId: 'example'},
    nodes: [
      {id: 'pedals', label: 'Pedaler', detail: 'Du træder og drejer kranken.', sourceId: 'example'},
      {id: 'chain', label: 'Kæde', detail: 'Kæden forbinder tandhjulene foran og bagpå.', sourceId: 'example'},
      {id: 'wheel', label: 'Baghjul', detail: 'Gearvalget ændrer forholdet mellem pedaltråd og hjulets omdrejninger.',
        sourceId: 'example'},
    ],
    sources: example('Gemt dansk forklaring baseret på REI Expert Advice. Ikke et liveopslag.')}},
  {family: 'choices', title: 'En pause uden skærm', content: {summary: PAUSE, sources: local,
    items: activities.map(a => ({id: a.id, label: a.label, detail: a.detail, sourceId: 'example'}))}},
  {family: 'comparison', title: 'En pause uden skærm', content: {summary: PAUSE, sources: local,
    columns: [{id: 'time', label: 'Tid'}, {id: 'materials', label: 'Materialer'}],
    items: activities.map(a => ({id: a.id, label: a.label,
      values: [`${String(a.minutes)} min`, String(a.materials)], sourceId: 'example'}))}},
  {family: 'chart', title: 'En pause uden skærm', content: {summary: PAUSE, sources: local, unit: 'minutter',
    unitSingular: 'minut', items: activities.map(a => ({id: a.id, label: a.label, value: a.minutes,
      sourceId: 'example'}))}},
  {family: 'steps', title: 'Fold et papirfly', content: {summary: 'Fold papir', sources: local, steps: [
    'Find et ark papir, og læg det på bordet.', 'Fold arket på midten, og åbn det igen.',
    'Fold de to øverste hjørner ind mod midten.', 'Fold siderne ind igen. Fold midten, og giv flyet vinger.',
  ].map((text, i) => ({id: `step-${String(i + 1)}`, text, sourceId: 'example'}))}},
  {family: 'checklist', title: 'Klar til at lave et kort?', content: {summary: 'Papir, farver og lim.', sources: local,
    items: [['paper', 'Papir', true], ['colors', 'Farver', false], ['glue', 'Lim', false]].map(([id, label, checked]) =>
      ({id, label, checked, sourceId: 'example'}))}},
  {family: 'concise', title: 'Skal jeg tage en jakke med?', content: {
    summary: 'En let jakke er en god idé. Det er 15° nu og bliver køligere i aften.', sources: local}},
];

// A follow-up (`addonAnswers.followUp`): a second answer in the moon answer's voice session, a little later.
const FOLLOW_UP = {family: 'fact-card', title: 'Hvor lang tid tager lyset?', content: {
  summary: 'Lyset fra Månen er lidt over et sekund om at nå Jorden.',
  facts: [{id: 'light', label: 'Lysets rejsetid', value: '1,3 s', detail: 'Ved den gennemsnitlige afstand.',
    sourceId: 'example'}],
  sources: example('Gemt forklaring til forhåndsvisning.')}};

export function addonHistory(now = Date.now(), state: AddonState = 'ready') {
  const seconds = Math.floor(now / 1000);
  const base = EXAMPLES.map((item, index) => ({
    receiptId: RECEIPTS[index] ?? '',
    family: item.family,
    title: item.title,
    observedAt: seconds - 600 * (index + 1),
    content: structuredClone(item.content),
    provenance: {kind: 'owner_sources'},
    ...(index === 0 && addonAnswers.followUp ? {sessionId: 'session-moon'} : {}),
  }));
  const follow = addonAnswers.followUp ? [{receiptId: 'f'.repeat(32), family: FOLLOW_UP.family,
    title: FOLLOW_UP.title, observedAt: seconds - 480, content: structuredClone(FOLLOW_UP.content),
    provenance: {kind: 'owner_sources'}, sessionId: 'session-moon'}] : [];
  const forms = addonAnswers.forms ? FORM_EXAMPLES.map((item, index) => ({
    receiptId: (index + 1).toString(16).padStart(2, '0').repeat(16),
    family: item.family,
    title: item.title,
    observedAt: seconds - 1800 - 300 * index,
    content: structuredClone(item.content),
    provenance: {kind: 'owner_sources'},
  })) : [];
  const items = state === 'empty' ? [] : [...follow, ...base, ...forms];
  return {
    schema: 'podview.answer-history.v1' as const,
    roomId: 'kokken',
    bootId: 'boot-fixture',
    revision: items.length + 1,
    removalRevision: 0,
    receiptIds: items.map(item => item.receiptId),
    items,
  };
}

// `live`: GPT-Live is giving an answer right now (not saved yet). Its row is the wall page's own live-answer test
// shape (screens/answers/history-hydration.test.js: a tool result's »Temperatur 12 °C · Aktuel måling«).
export const addonAnswers = {state: 'ready' as AddonState, live: false, followUp: false, forms: false,
  pending: false};
const LIVE_RECEIPT = 'e'.repeat(32);

export function liveAnswerPush(now = Date.now()) {
  const state = addonAnswers.state;
  if (state === 'unavailable') return {ok: false, error: 'addon_unavailable'};
  if (state === 'unknown_room') return {ok: false, error: 'unknown_room'};
  const history = addonHistory(now, state);
  const revision = addonAnswers.live ? 2 : 1;
  const turn = {sessionId: 'session-live', turnId: 'turn-live', taskId: 'task-live', inputRevision: 1};
  const items = addonAnswers.live
    ? [{
        receiptId: LIVE_RECEIPT, ...turn, observedAt: now / 1000, provenance: {kind: 'tool_result'},
        family: 'fact-card', displaySuggested: true,
        content: {
          summary: 'Observeret svar',
          facts: [{id: 'fact', label: 'Temperatur', value: '12 °C', detail: 'Aktuel måling', sourceId: 'source'}],
          sources: [{id: 'source', kind: 'owner_receipt', receiptId: LIVE_RECEIPT, label: 'Værktøjsresultat',
            scope: 'tool_result'}],
        },
      }]
    : [];
  return {
    ok: true,
    snapshot: {
      bootId: history.bootId, roomId: history.roomId, voice: {sessionId: 'session-live', active: true},
      capabilities: {answerRead: true, researchVisual: false}, answers: {revision, ...turn},
      answerHistoryRevision: history.revision, answerHistoryRemovalRevision: history.removalRevision,
      answerHistoryReceiptIds: history.receiptIds,
    },
    live: {schema: 'podview.answers.v1', roomId: history.roomId, revision, items,
      ...(addonAnswers.pending ? {pending: {roomId: history.roomId, revision, ...turn, turnId: 'turn-next'}} : {})},
    history,
  };
}

// podvoice.weather_place: the add-on's podview_weather_city, as on Green (tests set it before mounting).
export const fakeWeatherPlace = {name: 'Mårslet', source: 'configured_label'};

// podvoice.weather_advice: the add-on's AI weather advice (A-Vejr's sentence). `status` is what a start answers;
// with `pendingReads` set, a start answers »pending« and the advice is ready on that many reads later.
export const fakeWeatherAdvice: {status: 'ready' | 'pending' | 'error' | 'unavailable'; summary: string;
  pendingReads: number} = {
  status: 'ready',
  summary: 'Det bliver køligere i aften, fra 5 °C kl. 20 til 2 °C ved midnat; tag en varm jakke på.',
  pendingReads: 0,
};
export const resetFakeWeatherAdvice = () => {
  Object.assign(fakeWeatherAdvice, {status: 'ready', pendingReads: 0,
    summary: 'Det bliver køligere i aften, fra 5 °C kl. 20 til 2 °C ved midnat; tag en varm jakke på.'});
};

export function installAddonFake(fake: FakeHass): void {
  fake.handle('podvoice.weather_place', () => ({response: {ok: true, ...fakeWeatherPlace}}));
  let adviceReads = 0;
  fake.handle('podvoice.weather_advice', data => {
    const start = data.start === true;
    adviceReads = start ? 0 : adviceReads + 1;
    const waiting = fakeWeatherAdvice.pendingReads > adviceReads;
    const status = waiting ? 'pending' : fakeWeatherAdvice.status;
    return {response: {ok: true, status, summary: status === 'ready' ? fakeWeatherAdvice.summary : null,
      validUntil: status === 'ready' ? Math.floor(Date.now() / 1000) + 900 : null}};
  });
  addonAnswers.state = 'ready';
  addonAnswers.live = false;
  addonAnswers.followUp = false;
  addonAnswers.forms = false;
  addonAnswers.pending = false;
  fake.subscribers.set('podvoice/answers_subscribe', () => liveAnswerPush());
  fake.handle('podvoice.answers_snapshot', () => {
    const state = addonAnswers.state;
    if (state === 'unavailable') return {response: {ok: false, error: 'addon_unavailable'}};
    if (state === 'unknown_room') return {response: {ok: false, error: 'unknown_room'}};
    return {response: {ok: true, history: addonHistory(Date.now(), state)}};
  });
}
