// Fake HA services for the PodVoice add-on bridge (installed by createFakeHass): podvoice/answers_subscribe
// pushes (and podvoice.answers_snapshot answers) two saved answers in the add-on's closed history shape
// (podview.answer-history.v1). Their content is copied from the wall page's own saved examples (visual-examples.js: »Hvor langt er der til Månen?« and »En rolig
// morgen«), so nothing here is invented. `addonAnswers` lets a test or the browser journey switch the add-on's state.
import type {FakeHass} from '../ha-fixture';

export type AddonState = 'ready' | 'empty' | 'unavailable' | 'unknown_room';

const RECEIPTS = ['c'.repeat(32), 'd'.repeat(32)];
const example = (scope: string) => [
  {id: 'example', label: 'Om forhåndsvisningen', url: 'example-sources.html', scope},
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

export function addonHistory(now = Date.now(), state: AddonState = 'ready') {
  const seconds = Math.floor(now / 1000);
  const items =
    state === 'empty'
      ? []
      : EXAMPLES.map((item, index) => ({
          receiptId: RECEIPTS[index] ?? '',
          family: item.family,
          title: item.title,
          observedAt: seconds - 600 * (index + 1),
          content: structuredClone(item.content),
          provenance: {kind: 'owner_sources'},
        }));
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
export const addonAnswers = {state: 'ready' as AddonState, live: false};
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
    live: {schema: 'podview.answers.v1', roomId: history.roomId, revision, items},
    history,
  };
}

export function installAddonFake(fake: FakeHass): void {
  addonAnswers.state = 'ready';
  addonAnswers.live = false;
  fake.subscribers.set('podvoice/answers_subscribe', () => liveAnswerPush());
  fake.handle('podvoice.answers_snapshot', () => {
    const state = addonAnswers.state;
    if (state === 'unavailable') return {response: {ok: false, error: 'addon_unavailable'}};
    if (state === 'unknown_room') return {response: {ok: false, error: 'unknown_room'}};
    return {response: {ok: true, history: addonHistory(Date.now(), state)}};
  });
}
