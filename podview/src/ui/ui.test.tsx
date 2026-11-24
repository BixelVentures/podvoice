import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {describe, expect, it, vi} from 'vitest';
import {Button, Chip, Choices, Modal, Slider, Switch} from '.';

describe('PodView components', () => {
  it('a Button answers a tap and is never locked by a command in flight (busy only marks it)', async () => {
    const press = vi.fn();
    render(<Button busy onPress={press}>Afspil</Button>);
    const key = screen.getByRole('button', {name: 'Afspil'});
    expect(key.dataset.busy).toBe('true');
    await userEvent.click(key);
    await userEvent.click(key);
    expect(press).toHaveBeenCalledTimes(2);
  });

  it('Choices is one radiogroup of radios: the chosen chip is checked at once and stays chosen', async () => {
    const user = userEvent.setup();
    function Rooms() {
      const [room, setRoom] = useState('kokken');
      return (
        <Choices aria-label="Rum" value={room} onChange={setRoom}>
          <Chip id="kokken">Køkken</Chip>
          <Chip id="stue">Stue</Chip>
        </Choices>
      );
    }
    render(<Rooms />);
    expect(screen.getByRole('radiogroup', {name: 'Rum'})).toBeTruthy();
    expect(screen.getByRole('radio', {name: 'Køkken'}).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', {name: 'Stue'}));
    expect(screen.getByRole('radio', {name: 'Stue'}).getAttribute('aria-checked')).toBe('true');
    // A tap on the chosen chip keeps it chosen.
    await user.click(screen.getByRole('radio', {name: 'Stue'}));
    expect(screen.getByRole('radio', {name: 'Stue'}).getAttribute('aria-checked')).toBe('true');
  });

  it('a Switch is a switch the whole row toggles', async () => {
    const change = vi.fn();
    render(<Switch aria-label="Køkkenø" isSelected={false} onChange={change}><span>Køkkenø</span></Switch>);
    const lamp = screen.getByRole('switch', {name: 'Køkkenø'});
    expect((lamp as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByText('Køkkenø'));
    expect(change).toHaveBeenCalledWith(true);
  });

  it('a Slider sends once per change and keeps no draft afterwards', () => {
    const commit = vi.fn();
    const {rerender} = render(<Slider label="Lydstyrke" value={30} format={v => `${String(v)} %`} onCommit={commit} />);
    const input = screen.getByRole('slider', {name: 'Lydstyrke'});
    expect(screen.getByText('30 %')).toBeTruthy();
    // A change outside a drag (keyboard, assistive technology) ends at once: one command.
    fireEvent.change(input, {target: {value: '55'}});
    expect(commit).toHaveBeenCalledWith(55);
    expect(commit).toHaveBeenCalledTimes(1);
    // HA's value is shown again: no draft outlives the gesture.
    rerender(<Slider label="Lydstyrke" value={40} format={v => `${String(v)} %`} onCommit={commit} />);
    expect(screen.getByText('40 %')).toBeTruthy();
  });

  it('a Slider without a level says so', () => {
    render(<Slider label="Lysstyrke" value={null} format={v => `${String(v)} %`} onCommit={() => undefined} />);
    expect(screen.getByText('Ikke oplyst')).toBeTruthy();
  });

  it('a Modal holds the dialog in one portal and Escape closes it', async () => {
    const user = userEvent.setup();
    function Ask() {
      const [open, setOpen] = useState(true);
      return (
        <Modal isOpen={open} onClose={() => { setOpen(false); }} title="Afspil på">
          <Button onPress={() => { setOpen(false); }}>Stue</Button>
        </Modal>
      );
    }
    render(<Ask />);
    const dialog = screen.getByRole('dialog', {name: 'Afspil på'});
    expect(dialog).toBeTruthy();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
