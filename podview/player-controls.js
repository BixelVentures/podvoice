// Transport and volume, painted for every source (renderPlayerControls from the pre-React player-view.js). React
// draws these elements (src/screens/player/PlayerScreen.tsx) and never sets their state: it is painted here,
// natively, because several owners write it: this painter (called by the player, the room player's controls and
// live radio), the room player's busy marks, the live volume gesture (live-control-view.js) and the kit's progress.
// A range the user is dragging keeps its value until the gesture ends.
import {applyKitComponent, syncKitSlider} from './ui/kit.js';

const TRANSPORT = [[['previous', 'detail-previous'], 'previous'], [['next', 'detail-next'], 'next'],
  [['play-pause', 'detail-toggle'], 'toggle']];
const GROUPS = ['.player .transport', '#music-detail .transport', '.player .volume', '#music-detail .volume'];

export function renderPlayerControls(host, {playing = false, previous = false, next = false, toggle = false,
  blocked = false, volumeBlocked = blocked, volume = null, canVolume = false, min = 0, max = 100, gesture = null,
  sourceKind = 'music', loadingControlId = null, pendingLabel = null} = {}) {
  const doc = host.ownerDocument || document, $ = id => doc.getElementById(id), radio = sourceKind === 'radio';
  const allowed = {previous, next, toggle};
  for (const [ids, action] of TRANSPORT) for (const id of ids) {
    const button = $(id);
    if (!button) continue;
    const hidden = radio && id !== 'play-pause' && id !== 'detail-toggle';
    if (button.hidden !== hidden) button.hidden = hidden;
    const disabled = blocked || !allowed[action];
    if (button.disabled !== disabled) button.disabled = disabled;
  }
  for (const id of ['play-pause', 'detail-toggle']) {
    const button = $(id);
    if (!button || !(radio || button.dataset?.feedback === 'progress')) continue;
    if (radio && button.radioProgressVariant === undefined)
      button.radioProgressVariant = button.dataset.kitVariant || '';
    applyKitComponent(button, 'button', {variant: 'icon', feedback: 'progress',
      loading: radio && (loadingControlId === id || loadingControlId === 'play-pause' && id === 'detail-toggle')});
    if (!radio && button.radioProgressVariant !== undefined) {
      if (button.radioProgressVariant) button.dataset.kitVariant = button.radioProgressVariant;
      else {
        delete button.dataset.kitVariant;
        button.removeAttribute?.('data-kit-variant');
      }
      delete button.radioProgressVariant;
    }
  }
  const toggleLabel = radio && pendingLabel ? pendingLabel
    : radio ? (playing ? 'Stop radio' : 'Start radio ved livepunkt')
      : playing ? 'Sæt musik på pause' : 'Fortsæt musikken';
  for (const id of ['play-pause', 'detail-toggle']) {
    const button = $(id);
    if (button && button.getAttribute?.('aria-label') !== toggleLabel) button.setAttribute('aria-label', toggleLabel);
  }
  for (const selector of GROUPS) {
    const node = host.querySelector(selector) || doc.querySelector?.(selector);
    const hidden = selector.startsWith('#music-detail');
    if (node && node.hidden !== hidden) node.hidden = hidden;
  }
  for (const row of host.playerView?.rows?.values?.() || [])
    if (row.queueItem?.current) row.disabled = blocked || !toggle;
  const known = Number.isInteger(volume) && volume >= 0 && volume <= 100;
  host.playerView?.syncVolumeMute?.({volume, blocked: volumeBlocked, canVolume, min, max});
  for (const id of ['volume', 'detail-volume']) {
    const input = $(id);
    if (!input) continue;
    const disabled = volumeBlocked || !canVolume || !known, witness = host.playerView?.volumeGestures?.get(input);
    const editing = input === gesture || radio && !disabled && witness?.sourceKind === 'radio'
      && (witness.mode !== 'pointer' || witness.pointerHeld === true)
      && host.playerView?.volumeGestureCurrent?.(witness) === true;
    if (input.getAttribute?.('aria-label') !== 'Lydstyrke') input.setAttribute?.('aria-label', 'Lydstyrke');
    const spokenVolume = known ? (editing ? input.value : volume) + ' %' : 'Ukendt lydstyrke';
    if (input.getAttribute?.('aria-valuetext') !== spokenVolume) input.setAttribute?.('aria-valuetext', spokenVolume);
    if (input.disabled !== disabled) input.disabled = disabled;
    if (input.min !== '0') input.min = '0';
    if (input.max !== '100') input.max = '100';
    for (const [key, bound] of [['actionMin', min], ['actionMax', max]])
      if (input.dataset[key] !== String(bound)) input.dataset[key] = String(bound);
    if (input.dataset.kitValueKnown !== String(known)) input.dataset.kitValueKnown = String(known);
    if (known && !editing && input.value !== String(volume)) input.value = String(volume);
    syncKitSlider(input);
    const output = $(id === 'volume' ? 'volume-value' : 'detail-volume-value'), label = known ? volume + ' %' : '—';
    if (output && (!editing || !known) && output.textContent !== label) output.textContent = label;
  }
}
