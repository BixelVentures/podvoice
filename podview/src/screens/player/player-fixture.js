// Shared real-DOM fixture for the player's Vitest suites: the part of podview/index.html the player and the speaker
// sheet use, set up as widget-view.js does (the player and the sheet mounted once, the shell bound through the
// player's ports). Taps the player asks of the shell are recorded.
import {act} from '@testing-library/react';
import {afterEach} from 'vitest';
import {applyKitDialog, applyKitTemplate} from '../../../ui/kit.js';
import {mountPlayer} from './Player';
import {mountSpeakerSheet} from './SpeakerSheet';
import {SpeakerPicker} from './speakers';
import {resetSession} from './session';
import {bindPlayer, resetPlayer} from './store';

export const PLAYER_SHELL = `<pv-widget-host><main><aside class="player" hidden aria-labelledby="player-title"></aside>
<aside id="player-empty" class="player-empty" hidden></aside><section id="music-response" hidden></section></main>
<section id="music-detail" hidden aria-labelledby="detail-title"></section></pv-widget-host>
<dialog id="rooms" role="dialog" aria-modal="true" aria-labelledby="room-title"></dialog>
<p id="playback-status" hidden></p>`;

let unmounts = [];
afterEach(() => {
  act(() => {
    for (const unmount of unmounts) unmount();
  });
  unmounts = [];
  resetPlayer();
  resetSession();
  document.body.innerHTML = '';
});

// Plain, writable fields on the host element (isConnected too, which tests turn off).
export function assign(host, fields) {
  for (const [key, value] of Object.entries(fields))
    Object.defineProperty(host, key, {value, configurable: true, writable: true, enumerable: true});
  return host;
}

// The shell's dialog opening as widget-view.js's open('rooms') does it.
export function openSheet(host) {
  const rooms = document.getElementById('rooms');
  if (!rooms.open) rooms.showModal();
  const radio = host.liveRadio;
  if (radio?.ownsPlayer()) {
    radio.openOutputs();
    return undefined;
  }
  radio?.setState({outputOpen: false});
  return host.liveOutputs?.open();
}

// A fresh shell; `fields` are assigned onto its host element before the player binds (and `prepare(host)` runs then,
// for owners built over the host itself, such as the radio source). Returns the host, the taps the player asked of
// the shell, and the document's elements by id.
export function playerShell(fields = {}, prepare = undefined) {
  document.body.innerHTML = PLAYER_SHELL;
  const host = document.querySelector('pv-widget-host');
  const taps = {music: [], seek: [], queue: [], detail: [], speakers: [], moveHere: [], findMusic: [], back: 0,
    feedback: []};
  assign(host, {isConnected: true, ...fields});
  prepare?.(host);
  bindPlayer(host, {
    music: event => {
      taps.music.push(event);
      host.music?.(event);
    },
    seek: event => taps.seek.push(event),
    chooseQueue: item => taps.queue.push(item),
    openDetail: opener => taps.detail.push(opener),
    back: () => {
      taps.back++;
    },
    openSpeakers: opener => {
      taps.speakers.push(opener);
      void openSheet(host);
    },
    moveHere: opener => taps.moveHere.push(opener),
    findMusic: action => taps.findMusic.push(action),
    showFeedback: (text, source) => taps.feedback.push({text, source}),
  });
  const $ = id => document.getElementById(id);
  applyKitTemplate($('music-detail'), 'detail');
  applyKitDialog($('rooms'));
  act(() => {
    unmounts.push(mountPlayer(document), mountSpeakerSheet($('rooms')));
  });
  return {host, taps, $, doc: document};
}

// Flush React after a change outside it (a store write, a resolved read, a timer).
export async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

export function flush() {
  act(() => undefined);
}

// A click as the user makes it: the browser drops it on a disabled control.
export const click = node => {
  act(() => {
    node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
  });
};

// A live speaker picker (speakers.ts) on a fresh shell, as the shell builds it (host.liveOutputs), and `view`: the
// picker with every call flushed through React (act), so the drawn sheet is current when a call returns. Its
// `refresh` is the drawn »Opdater liste«.
let currentPicker = null;
export function mountSpeakers(fields = {}, prepare = undefined) {
  let picker;
  const shell = playerShell({live: true, ...fields}, host => {
    prepare?.(host);
    picker = host.liveOutputs = new SpeakerPicker(host);
  });
  currentPicker = picker;
  return {...shell, picker, view: actView(picker)};
}

// An owner whose calls are flushed through React (act): the drawn DOM is current when a call (or its promise)
// returns.
export function actView(target) {
  return new Proxy(target, {
    get(object, key) {
      if (key === 'refresh') return document.querySelector('#rooms .speaker-list-refresh');
      const value = Reflect.get(object, key, object);
      if (typeof value !== 'function') return value;
      return (...args) => {
        let result;
        act(() => {
          result = value.apply(object, args);
        });
        if (!result || typeof result.then !== 'function') return result;
        const pending = result;
        // React's act() thenable is not a Promise (its then() returns nothing): wait for it in an async function.
        return (async () => {
          await act(async () => {
            await pending;
          });
          return pending;
        })();
      };
    },
    set(object, key, value) {
      act(() => {
        Reflect.set(object, key, value, object);
      });
      return true;
    },
  });
}

// The catalogue row a drawn speaker row shows (the picker's own object).
export function rowOf(node) {
  return currentPicker?.catalogue.find(row => row.speakerId === node?.dataset.speakerId);
}
