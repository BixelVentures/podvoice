// Kit-Kontroller's controls and A-Lys's surfaces: what each shows and how it answers a tap, a key and a drag.
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ChoiceTile, Dialog, IconKey, resetTapGuard, Segment, Sheet, Slider, SwitchKey, ToggleCard, wasDrag} from '.';

describe('Kit-Kontroller', () => {
  beforeEach(() => {
    resetTapGuard();
  });

  it('Segment: a radiogroup; a tap or an arrow key chooses, the chosen one stays chosen', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<Segment aria-label="Sædevarme" value="lav" onChange={change}
      options={[{id: 'fra', label: 'Fra'}, {id: 'lav', label: 'Lav'}, {id: 'hoej', label: 'Høj'}]} />);
    expect(screen.getByRole('radiogroup', {name: 'Sædevarme'})).toBeTruthy();
    expect(screen.getByRole('radio', {name: 'Lav'}).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', {name: 'Høj'}));
    expect(change).toHaveBeenLastCalledWith('hoej');
    await user.click(screen.getByRole('radio', {name: 'Lav'}));
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('Slider (kit): the level in mono, »—« when unknown; a key sends once', () => {
    const commit = vi.fn();
    const {rerender} = render(<Slider variant="kit" tone="lys" showLabel label="Lysstyrke" value={60}
      format={value => `${String(value)} %`} onCommit={commit} />);
    expect(screen.getByText('60 %')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('slider', {name: 'Lysstyrke'}), {key: 'ArrowRight'});
    expect(commit).toHaveBeenCalledWith(61);
    rerender(<Slider variant="kit" tone="lys" showLabel label="Lysstyrke" value={null}
      format={value => `${String(value)} %`} onCommit={commit} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('IconKey and SwitchKey name themselves; a drag’s release is no press', async () => {
    const user = userEvent.setup();
    const press = vi.fn();
    const change = vi.fn();
    render(<><IconKey icon="close" aria-label="Luk" onPress={press} />
      <SwitchKey aria-label="Tænd Pendler" isSelected={false} onChange={change} /></>);
    await user.click(screen.getByRole('button', {name: 'Luk'}));
    expect(press).toHaveBeenCalledTimes(1);
    const label = screen.getByRole('switch', {name: 'Tænd Pendler'}).closest('label');
    if (!label) throw Error('no label');
    await user.pointer([
      {keys: '[MouseLeft>]', target: label, coords: {clientX: 10, clientY: 10}},
      {target: label, coords: {clientX: 80, clientY: 12}},
      {keys: '[/MouseLeft]', target: label, coords: {clientX: 80, clientY: 12}},
    ]);
    expect(wasDrag()).toBe(true);
    expect(change).not.toHaveBeenCalled();
    await user.click(label);
    expect(change).toHaveBeenCalledWith(true);
  });

  it('Dialog: an alertdialog with Annullér and the action; Escape cancels', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(<Dialog isOpen title="Kør til basen?" description="Rengøringen stopper, og robotten kører tilbage."
      cancelLabel="Annullér" confirmLabel="Kør til basen" onConfirm={confirm} onCancel={cancel} />);
    const dialog = screen.getByRole('alertdialog', {name: 'Kør til basen?'});
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    await user.click(screen.getByRole('button', {name: 'Kør til basen'}));
    expect(confirm).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalled();
  });

  it('Sheet: a dialog with its own round »Luk«', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<Sheet isOpen title="Skærm og enhed" description="iPad" onClose={close}><p>Indhold</p></Sheet>);
    expect(screen.getByRole('dialog', {name: 'Skærm og enhed'})).toBeTruthy();
    const [luk] = screen.getAllByRole('button', {name: 'Luk'});
    if (!luk) throw Error('no Luk');
    await user.click(luk);
    expect(close).toHaveBeenCalled();
  });

  it('ToggleCard and ChoiceTile: the card chooses, its switch powers; a tile says chosen', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const power = vi.fn();
    const pick = vi.fn();
    render(<>
      <ToggleCard tone="lys" tag="Rum" name="Stue" status="Slukket" on={false} isSelected={false} onSelect={select}
        power={{'aria-label': 'Tænd alle lys i Stue', isSelected: false, onChange: power}} />
      <ChoiceTile tone="lys" title="Morgen" meta="60 %" isSelected onPress={pick} />
    </>);
    await user.click(screen.getByRole('button', {name: /Stue/}));
    expect(select).toHaveBeenCalledTimes(1);
    expect(power).not.toHaveBeenCalled();
    await user.click(screen.getByRole('switch', {name: 'Tænd alle lys i Stue'}));
    expect(power).toHaveBeenCalledWith(true);
    expect(select).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', {name: /Morgen/}).getAttribute('aria-pressed')).toBe('true');
  });
});
