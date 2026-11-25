// The kit's stories: each component of the design canvas's kit with the canvas's own sample content (gallery/
// samples.ts), checked for what it shows and how it answers. The pictures are the gallery's (/podview/_kit), laid
// next to the canvas boards.
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {
  ActionTile, Button, Fresh, freshText, Notice, NoticeSlot, Player, SvarCard, SvarMini, SvarScore,
  SvarToday, SwitchMark, Topbar, Widget, WIDGET_KINDS, WIDGET_STATES,
} from '.';
import type {WidgetState, SVAR_PILL} from '.';
import {DOT_COUNTS} from './DotMaterial';
import {KitGallery} from './gallery/KitGallery';
import {WIDGET_SAMPLES} from './gallery/samples';

describe('the kit', () => {
  it('K-Widget: every domain in every state draws its anatomy, and the whole widget is one press', async () => {
    for (const kind of WIDGET_KINDS) {
      for (const state of WIDGET_STATES[kind] as readonly string[]) {
        const sample = WIDGET_SAMPLES[kind][state] ?? {prim: ''};
        const press = vi.fn();
        const {unmount} = render(<Widget kind={kind} state={state as WidgetState} {...sample} onPress={press} />);
        const widget = screen.getByRole('button', {name: new RegExp(`, ${sample.prim.replace(/[()]/g, '.')}`)});
        expect(widget.dataset.kind).toBe(kind);
        expect(widget.dataset.state).toBe(state);
        expect(widget.textContent).toContain(sample.prim);
        await userEvent.click(widget);
        expect(press).toHaveBeenCalledTimes(1);
        unmount();
      }
    }
  });

  it('the dot materials are the canvas algorithm: the same dots every time', () => {
    expect(DOT_COUNTS).toEqual({cloud: 602, arcs: 365, arcsBroken: 244, bulb: 141, car: 170});
    const {container} = render(<Widget kind="vejr" state="frisk" {...WIDGET_SAMPLES.vejr.frisk} prim="Skyet" />);
    const first = [...container.querySelectorAll('rect')].map(rect => rect.outerHTML).join();
    const again = render(<Widget kind="vejr" state="frisk" prim="Skyet" />).container;
    expect([...again.querySelectorAll('rect')].map(rect => rect.outerHTML).join()).toBe(first);
  });

  it('a static state never moves; a running one breathes (and reduced motion stills it)', () => {
    const resting = render(<Widget kind="robot" state="oplader" prim="Oplader" />).container;
    expect(resting.querySelector('[class*="animate-pv"]')).toBeNull();
    const running = render(<Widget kind="robot" state="rengoer" prim="Rengør" />).container;
    const dot = running.querySelector('rect[class*="animate-pv-inward"]');
    expect(dot?.getAttribute('class')).toContain('motion-reduce:animate-none');
  });

  it('»+N« counts what the widget does not show, and a direct action is its own press', async () => {
    const open = vi.fn();
    const pause = vi.fn();
    render(<Widget kind="robot" state="rengoer" prim="Rengør" more={1} onPress={open}
      action={{label: 'Pause', onPress: pause}} />);
    expect(screen.getByRole('button', {name: 'Robotstøvsuger, Rengør, 1 robot mere'})).toBeTruthy();
    await userEvent.click(screen.getByRole('button', {name: 'Pause'}));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('K-Btn: seven looks, 56 and 44, an optional glyph; an icon alone is a round key', () => {
    render(
      <>
        <Button variant="primaer" size={56} icon="play">Afspil</Button>
        <Button variant="fare" size={44}>Lås op</Button>
        <Button variant="sekundaer" size={44} icon="pause" aria-label="Pause" />
      </>,
    );
    expect(screen.getByRole('button', {name: 'Afspil'}).className).toContain('h-14');
    expect(screen.getByRole('button', {name: 'Lås op'}).className).toContain('text-pv-danger');
    expect(screen.getByRole('button', {name: 'Pause'}).className).toContain('px-0');
  });

  it('K-Switch, K-Notice and K-Fresh say only the product’s own words', async () => {
    const close = vi.fn();
    const {container} = render(<SwitchMark on />);
    expect(container.querySelector('i')?.style.transform).toContain('22px');
    render(<Notice level="fejl" title="Robotfejl" text="Hovedbørsten sidder fast" />);
    render(<Notice level="info" title="Vejret er ikke opdateret" onClose={close} />);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', {name: 'Luk besked'}));
    expect(close).toHaveBeenCalledTimes(1);
    render(<Fresh text="Opdateret 9. nov., 11.02" />);
    expect(screen.getByText('Opdateret 9. nov., 11.02')).toBeTruthy();
  });

  it('K-Fresh speaks only after 30 minutes, with the time, never »Sidst kendt«', () => {
    const at = Date.parse('2026-11-09T11:02:00+01:00');
    expect(freshText(at, at + 29 * 60_000)).toBeNull();
    expect(freshText(at, at + 31 * 60_000)).toBe('Opdateret 9. nov., 11.02');
  });

  it('NoticeSlot shows one notice at a time; a confirmation goes by itself after 3 s', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<NoticeSlot notice={{id: 'ok', level: 'ok', title: 'Robotten er sendt til basen'}} onClose={close} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(close).toHaveBeenCalledWith('ok');
    vi.useRealTimers();
  });

  it('A-Topbar: the timer chip and the alert badge each take their own press; the grille shows the voice', async () => {
    const timer = vi.fn();
    const alert = vi.fn();
    render(<Topbar heading="Tesla" back={{onPress: () => undefined}} onRest={() => undefined}
      svar={{onPress: () => undefined, current: false}} voice="ripple" clock="14.30" date="Man. 9. nov."
      timer={{count: '3:42', name: 'Pasta', left: 0.5, onPress: timer}}
      alert={{text: 'Robotfejl', domain: 'Robot', onPress: alert}} />);
    await userEvent.click(screen.getByRole('button', {name: 'Timer 3:42, Pasta'}));
    await userEvent.click(screen.getByRole('button', {name: 'Robotfejl. Gå til Robot'}));
    expect([timer.mock.calls.length, alert.mock.calls.length]).toEqual([1, 1]);
    expect(screen.getByText('Lytter…')).toBeTruthy();
  });

  it('K-ActionTile: busy marks itself and never locks', async () => {
    const press = vi.fn();
    render(<ActionTile tone="busy" label="Døre" value="Ulåst" hint="Låser…" icon="unlock" onPress={press} />);
    const tile = screen.getByRole('button', {name: 'Døre: Ulåst. Låser…'});
    expect(tile.dataset.busy).toBe('true');
    await userEvent.click(tile);
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('Kit-SvarKnap: the Svar key\'s seven states, each with its own label; unread adds the red dot', async () => {
    const svar = vi.fn();
    const labels: Record<string, string> = {hvile: 'Svar', lytter: 'Lytter…', taenker: 'Tænker…', svarer: 'Svarer…',
      ulaest: 'Svar', fejl: 'Svar kom ikke', offline: 'Offline'};
    for (const [state, label] of Object.entries(labels)) {
      const {unmount} = render(<Topbar heading="Hjem" onRest={() => undefined} svar={{onPress: svar, current: false}}
        svarState={state as keyof typeof SVAR_PILL} clock="14.30" date="Man. 9. nov." />);
      const key = screen.getByRole('button', {name: /^Se tidligere svar/});
      expect([key.dataset.svarState, key.textContent]).toEqual([state, label]);
      expect(!!key.querySelector('i.bg-pv-live')).toBe(state === 'ulaest');
      await userEvent.click(key);
      unmount();
    }
    expect(svar).toHaveBeenCalledTimes(7);
  });

  it('A-SvarKort: the card\'s anatomy, follow-ups on top, »bygges« in the same places, and »I dag«', async () => {
    const open = vi.fn();
    const newer = vi.fn();
    render(
      <div>
        <SvarCard icon="ball" kind="Resultat · 8. nov." time="11.32" title="Atlético 1–2 Barcelona"
          question="Hvordan gik Atlético mod Barcelona?"
          followUps={[{id: 'f', question: 'Hvem lavede assist?', answer: 'Assist: Pedri', time: '11.34'}]}>
          <SvarScore home={{name: 'Atlético', tag: 'ATM', score: 1}} away={{name: 'Barcelona', tag: 'FCB', score: 2}} />
        </SvarCard>
        <SvarCard icon="rain" kind="Vejr" time="11.32" title="" building />
        <SvarToday title="I dag" newer="1 nyt svar" onNewer={newer}>
          <SvarMini id="a" icon="info" kind="Fakta" time="08.30" title="Ja" question="Skal vi gå en tur?" current
            onPress={open} />
        </SvarToday>
      </div>,
    );
    const card = screen.getByRole('article', {name: 'Resultat · 8. nov.'});
    expect(within(card).getByRole('heading', {level: 2}).textContent).toBe('Atlético 1–2 Barcelona');
    expect(within(card).getByRole('group', {name: 'Atlético 1, Barcelona 2'})).toBeTruthy();
    expect(card.querySelector('[data-follow-up]')?.textContent).toContain('Assist: Pedri');
    expect(screen.getByRole('status', {name: 'Svaret bygges'})).toBeTruthy();
    await userEvent.click(screen.getByRole('button', {name: 'Fakta · Ja · 08.30'}));
    await userEvent.click(screen.getByRole('button', {name: 'Vis nyeste svar · 1 nyt svar'}));
    expect([open.mock.calls.length, newer.mock.calls.length]).toEqual([1, 1]);
  });

  it('A-Topbar: Ro on Hjem, the back key and the title elsewhere; Svar always', async () => {
    const rest = vi.fn();
    const svar = vi.fn();
    const {rerender} = render(<Topbar heading="Hjem" onRest={rest} svar={{onPress: svar, current: false}}
      weather={{temperature: '8°', condition: 'Skyet', glyph: 'sun'}} clock="14.30" date="Man. 9. nov." />);
    await userEvent.click(screen.getByRole('button', {name: 'Gå til Ro'}));
    await userEvent.click(screen.getByRole('button', {name: 'Se tidligere svar'}));
    expect([rest.mock.calls.length, svar.mock.calls.length]).toEqual([1, 1]);
    expect(screen.getByText('14.30')).toBeTruthy();
    rerender(<Topbar heading="Lys" back={{onPress: () => undefined}} onRest={rest}
      svar={{onPress: svar, current: false}} clock="14.30" date="Man. 9. nov." />);
    expect(screen.queryByRole('button', {name: 'Gå til Ro'})).toBeNull();
    expect(screen.getByRole('button', {name: 'Tilbage'})).toBeTruthy();
    expect(screen.getByRole('heading', {level: 1, name: 'Lys'})).toBeTruthy();
  });

  it('A-Player: each mode has its own way on; another account is shown, never controlled', async () => {
    const pick = vi.fn();
    const toggle = vi.fn();
    const picker = {label: 'Køkkenalrum', 'aria-label': 'Rum: Køkkenalrum · Vælg rum', onPress: pick};
    const {rerender} = render(<Player mode="mine" picker={picker} title="Fast Car" artist="Y.V.E. 48" playing
      onToggle={toggle} volume={{value: 35, disabled: false, onCommit: () => undefined}} />);
    await userEvent.click(screen.getByRole('button', {name: 'Rum: Køkkenalrum · Vælg rum'}));
    await userEvent.click(screen.getByRole('button', {name: 'Pause'}));
    expect([pick.mock.calls.length, toggle.mock.calls.length]).toEqual([1, 1]);
    expect(screen.getByRole('slider', {name: 'Lydstyrke'})).toBeTruthy();
    rerender(<Player mode="other" picker={picker} title="Heartless" artist="Kanye West" />);
    expect(screen.getByText('Bruges af en anden')).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'Pause'})).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', {name: 'Rum: Køkkenalrum · Vælg rum'}).disabled).toBe(true);
    rerender(<Player mode="idle" picker={picker} />);
    expect(screen.getByRole('button', {name: 'Find musik'})).toBeTruthy();
    rerender(<Player mode="offline" picker={picker}
      offline={{note: 'PodView kan ikke nå musikken lige nu.', retryLabel: 'Prøv igen', onRetry: toggle}} />);
    await userEvent.click(screen.getByRole('button', {name: 'Prøv igen'}));
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('the gallery shows every K-Widget state', () => {
    render(<KitGallery />);
    const widgets = within(screen.getByRole('region', {name: 'Widgets'}));
    const count = WIDGET_KINDS.reduce((sum, kind) => sum + WIDGET_STATES[kind].length, 0);
    expect(widgets.getAllByRole('button').length).toBe(count + 2);
  });
});
