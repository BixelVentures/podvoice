import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {readAnswers} from '../../lib/ha/answers';
import {commands} from '../../lib/ha/commands';
import {addonAnswers, addonHistory, liveAnswerPush} from '../../lib/ha/fixtures/addon';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {queryClient} from '../../lib/query/client';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';
import {answersState, combinedAnswers} from './Answers';
import {applyPush} from '../../lib/ha/answers';

let fake: FakeHass;

function mount() {
  // Only this test's fake feeds the transport (an earlier test's fake may still publish late effects).
  let own: FakeHass | null = null;
  own = createFakeHass({confirmMs: 20, onChange: hass => {
    if (!own || fake !== own) return;
    act(() => {
      transport.setHass(hass);
    });
  }});
  fake = own;
  transport.setPanel(FAKE_PANEL);
  transport.setHass(fake.hass);
  transport.resync();
  return render(
    <Providers>
      <Shell />
    </Providers>,
  );
}

const openSvar = () => {
  act(() => {
    useNav.getState().push('answers');
  });
};
// The answers are pushed from start; a resync (the page waking) subscribes again and gets the fake's new state.
const rereadOnWake = () => {
  act(() => {
    transport.resync();
  });
};
const reads = () => fake.calls.filter(call => call.service === 'answers_snapshot');
const subscriptions = () => fake.ws.filter(message => message.type === 'podvoice/answers_subscribe');
const pushAnswers = () => {
  act(() => {
    fake.pushAll('podvoice/answers_subscribe');
  });
};
const svar = () => screen.getByRole('region', {name: 'Svar', hidden: true});

describe('Svar on the panel', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
  });

  it('subscribes once at start (the card is ready before Svar opens) and never polls a service', async () => {
    mount();
    await screen.findByRole('button', {name: /Timer/});
    await waitFor(() => {
      expect(subscriptions()).toHaveLength(1);
    });
    openSvar();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(subscriptions()).toHaveLength(1);
    expect(reads()).toHaveLength(0);
  });

  it('shows the saved answers pushed for the room’s PodVoice endpoint', async () => {
    mount();
    openSvar();
    const view = within(svar());
    expect(await view.findByText('2 svar')).toBeTruthy();
    expect(subscriptions()[0]).toEqual({type: 'podvoice/answers_subscribe', room: 'kokken'});
    expect(view.getByRole('heading', {level: 2, name: 'I dag'})).toBeTruthy();
    const rows = view.getAllByRole('button', {name: / · .* · /});
    expect(rows.map(row => row.getAttribute('aria-label')?.split(' · ').slice(0, 2).join(' · '))).toEqual([
      'Fakta · Hvor langt er der til Månen?',
      'Tidslinje · En rolig morgen',
    ]);
    expect(rows[0]?.getAttribute('aria-current')).toBe('true');
    // The wall page's own card draws the newest answer.
    await waitFor(() => {
      expect(svar().querySelector('pv-answer h1')?.textContent).toBe('Hvor langt er der til Månen?');
    });
  });

  it('a row opens the other answer at once and sends nothing', async () => {
    const user = userEvent.setup();
    mount();
    openSvar();
    const view = within(svar());
    await user.click(await view.findByRole('button', {name: /En rolig morgen/}));
    await waitFor(() => {
      expect(svar().querySelector('pv-answer h1')?.textContent).toBe('En rolig morgen');
    });
    expect(view.getByRole('button', {name: /En rolig morgen/}).getAttribute('aria-current')).toBe('true');
    // Only reads: the panel's snapshot/state reads, never a command.
    const reads = new RegExp(
      '^(answers_snapshot|timer_status|speaker_rooms|robot_panel_state|vehicle_panel_state|radio_state' +
        '|robot_cleaning_state|vehicle_history|recipes_snapshot)$',
    );
    expect(fake.calls.filter(call => call.domain === 'podvoice' && !reads.test(call.service))).toEqual([]);
    expect(fake.calls.filter(call => call.domain !== 'podvoice' && call.domain !== 'weather')).toEqual([]);
  });

  it('a stopped add-on is said honestly and the rest of the panel is unaffected', async () => {
    const user = userEvent.setup();
    mount();
    addonAnswers.state = 'unavailable';
    rereadOnWake();
    openSvar();
    const view = within(svar());
    expect(await view.findByText('Tidligere svar kunne ikke hentes')).toBeTruthy();
    expect(view.getByText(/PodVoice svarer ikke lige nu – prøv igen om et minut/)).toBeTruthy();
    await user.click(screen.getByRole('button', {name: 'Tilbage'}));
    expect(await screen.findByRole('heading', {level: 1, name: 'Køkkenalrum'})).toBeTruthy();
    expect(screen.getByRole('button', {name: /Lys.*1 af 2 tændt/})).toBeTruthy();
  });

  it('answers already shown stay when the add-on stops', async () => {
    mount();
    openSvar();
    const view = within(svar());
    expect(await view.findByText('2 svar')).toBeTruthy();
    addonAnswers.state = 'unavailable';
    pushAnswers();
    expect(view.getAllByRole('button', {name: / · .* · /})).toHaveLength(2);
    expect(queryClient.getQueriesData({queryKey: ['ha', 'read', 'answers']}).length).toBeGreaterThan(0);
  });

  it('the answer GPT-Live is giving shows at once, before it is saved, as the newest', async () => {
    mount();
    openSvar();
    const view = within(svar());
    expect(await view.findByText('2 svar')).toBeTruthy();
    addonAnswers.live = true;
    pushAnswers();
    expect(await view.findByText('3 svar')).toBeTruthy();
    const rows = view.getAllByRole('button', {name: / · .* · /});
    expect(rows[0]?.getAttribute('data-live')).toBe('true');
    expect(rows[0]?.getAttribute('aria-current')).toBe('true');
    // Reading the newest, the new answer takes its place: no »nye svar« key.
    expect(view.queryByRole('button', {name: /Vis nyeste svar/})).toBeNull();
    expect(fake.calls.filter(call => call.domain === 'podvoice' && call.service === 'answers_snapshot')).toEqual([]);
  });

  it('»1 nyt svar« counts an answer that arrives while an older one is read, and jumps to it', async () => {
    const user = userEvent.setup();
    mount();
    openSvar();
    const view = within(svar());
    await user.click(await view.findByRole('button', {name: /En rolig morgen/}));
    addonAnswers.live = true;
    pushAnswers();
    const newer = await view.findByRole('button', {name: 'Vis nyeste svar · 1 nyt svar'});
    expect(newer.textContent).toBe('1 nyt svar');
    expect(view.getByRole('button', {name: /En rolig morgen/}).getAttribute('aria-current')).toBe('true');
    await user.click(newer);
    await waitFor(() => {
      expect(view.getAllByRole('button', {name: / · .* · /})[0]?.getAttribute('aria-current')).toBe('true');
    });
    expect(view.queryByRole('button', {name: /Vis nyeste svar/})).toBeNull();
  });

  it('an integration without the subscription reads once, and says when the history is not available', async () => {
    mount();
    fake.subscribers.delete('podvoice/answers_subscribe');
    fake.handle('podvoice.answers_snapshot', () => {
      throw Object.assign(new Error('Service podvoice.answers_snapshot not found'), {code: 'not_found'});
    });
    rereadOnWake();
    openSvar();
    expect(await within(svar()).findByText('Tidligere svar er ikke tilgængelige')).toBeTruthy();
  });

  it('an empty history says what will appear', async () => {
    mount();
    addonAnswers.state = 'empty';
    rereadOnWake();
    openSvar();
    expect(await within(svar()).findByText('Ingen visuelle svar endnu')).toBeTruthy();
  });
});

describe('Svar: reading the add-on history', () => {
  it('a push without the history keeps the saved answers; a live answer saved meanwhile is shown once', () => {
    addonAnswers.state = 'ready';
    addonAnswers.live = false;
    const first = applyPush(undefined, liveAnswerPush() as never);
    expect(first.ok && first.answers).toHaveLength(2);
    addonAnswers.live = true;
    const push = {...(liveAnswerPush() as object), history: null};
    const second = applyPush(first, push as never);
    expect(second.ok && [second.answers.length, second.live?.length]).toEqual([2, 1]);
    addonAnswers.live = false;
    if (second.ok) expect(combinedAnswers(second.answers, second.answers.slice(0, 1))).toHaveLength(2);
    expect(applyPush(second, {ok: false, error: 'addon_unavailable'})).toBe(second);
  });

  it('validates every saved answer with the wall page’s owner model', () => {
    const history = addonHistory();
    const read = readAnswers({ok: true, history});
    expect(read.ok && read.answers.map(answer => [answer.kind, answer.historical])).toEqual([
      ['fact-card', true],
      ['answer-timeline', true],
    ]);
    const tampered = {...history, receiptIds: [...history.receiptIds].reverse()};
    expect(readAnswers({ok: true, history: tampered})).toEqual({ok: false, error: 'unreadable'});
    expect(readAnswers({ok: false, error: 'addon_unavailable'})).toEqual({ok: false, error: 'addon_unavailable'});
  });

  it('states follow the wall page’s history copy', () => {
    const base = {connected: true, loading: false, failure: null, error: null, retained: false, empty: false};
    expect(answersState({...base, connected: false})?.title).toBe('Forbindelsen mangler');
    expect(answersState({...base, loading: true})?.title).toBe('Henter tidligere svar…');
    expect(answersState({...base, error: 'unknown_room'})?.title).toBe('Tidligere svar er ikke tilgængelige');
    expect(answersState({...base, failure: 'unknown'})?.detail).toBe(
      'Historikken opdateres, når forbindelsen tillader det.',
    );
    expect(answersState(base)).toBeNull();
  });
});
