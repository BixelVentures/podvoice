import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it} from 'vitest';
import {Providers} from '../../app/Providers';
import {readAnswers} from '../../lib/ha/answers';
import {commands} from '../../lib/ha/commands';
import {addonAnswers, addonHistory} from '../../lib/ha/fixtures/addon';
import {createFakeHass, FAKE_PANEL} from '../../lib/ha/ha-fixture';
import type {FakeHass} from '../../lib/ha/ha-fixture';
import {transport} from '../../lib/ha/transport';
import {queryClient} from '../../lib/query/client';
import {resetNav, useNav} from '../nav';
import {Shell} from '../Shell';
import {answersState} from './Answers';

let fake: FakeHass;

function mount() {
  fake = createFakeHass({confirmMs: 20, onChange: hass => {
    act(() => {
      transport.setHass(hass);
    });
  }});
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
const reads = () => fake.calls.filter(call => call.service === 'answers_snapshot');
const svar = () => screen.getByRole('region', {name: 'Svar', hidden: true});

describe('Svar on the panel', () => {
  beforeEach(() => {
    resetNav();
    commands.store.setState({wishes: {}});
  });

  it('reads nothing from the add-on until Svar opens', async () => {
    mount();
    await screen.findByRole('button', {name: /Timer/});
    expect(reads()).toHaveLength(0);
  });

  it('shows the saved answers through podvoice.answers_snapshot for the room’s PodVoice endpoint', async () => {
    mount();
    openSvar();
    const view = within(svar());
    expect(await view.findByText('2 svar')).toBeTruthy();
    expect(reads()[0]?.data).toEqual({room: 'kokken'});
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
    const reads = /^(answers_snapshot|timer_status|speaker_rooms|robot_panel_state|vehicle_panel_state|radio_state)$/;
    expect(fake.calls.filter(call => call.domain === 'podvoice' && !reads.test(call.service))).toEqual([]);
    expect(fake.calls.filter(call => call.domain !== 'podvoice' && call.domain !== 'weather')).toEqual([]);
  });

  it('a stopped add-on is said honestly and the rest of the panel is unaffected', async () => {
    const user = userEvent.setup();
    mount();
    addonAnswers.state = 'unavailable';
    openSvar();
    const view = within(svar());
    expect(await view.findByText('Tidligere svar kunne ikke hentes')).toBeTruthy();
    expect(view.getByText(/PodVoice svarer ikke lige nu – prøv igen om et minut/)).toBeTruthy();
    await user.click(screen.getByRole('button', {name: 'Tilbage'}));
    expect(await screen.findByRole('heading', {level: 1, name: 'Køkkenalrum'})).toBeTruthy();
    expect(screen.getByRole('button', {name: /Lys.*1 af 2 tændt/})).toBeTruthy();
  });

  it('answers already read stay when a later read fails', async () => {
    mount();
    openSvar();
    const view = within(svar());
    expect(await view.findByText('2 svar')).toBeTruthy();
    addonAnswers.state = 'unavailable';
    await act(async () => {
      await queryClient.refetchQueries({queryKey: ['ha', 'read', 'answers']});
    });
    expect(await view.findByText('Tidligere svar kunne ikke hentes')).toBeTruthy();
    expect(view.getByText(/De kendte svar er bevaret/)).toBeTruthy();
    expect(view.getAllByRole('button', {name: / · .* · /})).toHaveLength(2);
  });

  it('an integration without the service says the history is not available', async () => {
    mount();
    fake.handle('podvoice.answers_snapshot', () => {
      throw Object.assign(new Error('Service podvoice.answers_snapshot not found'), {code: 'not_found'});
    });
    openSvar();
    expect(await within(svar()).findByText('Tidligere svar er ikke tilgængelige')).toBeTruthy();
  });

  it('an empty history says what will appear', async () => {
    mount();
    addonAnswers.state = 'empty';
    openSvar();
    expect(await within(svar()).findByText('Ingen visuelle svar endnu')).toBeTruthy();
  });
});

describe('Svar: reading the add-on history', () => {
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
