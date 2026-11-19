// Shared real-DOM fixture for the player's Vitest suites (ported from the node:test fake DOMs in
// tests/podview/root-player-view.test.mjs and its siblings). The shell is the part of podview/index.html the player
// and the speaker picker use, set up as widget-view.js does: the player's elements mounted, then the shell's kit
// classes and dialog.
import {applyKitComponent, applyKitDialog, applyKitTemplate} from '../../../ui/kit.js';
import {PlayerView, mountPlayerScreen} from './PlayerView';
import {SpeakerOutputView} from './SpeakerOutputView';

export const PLAYER_SHELL = `<pv-widget-host><main><aside class="player" hidden aria-labelledby="player-title"></aside>
<aside id="player-empty" class="player-empty" hidden></aside></main>
<section id="music-detail" hidden aria-labelledby="detail-title"></section></pv-widget-host>
<dialog id="rooms" role="dialog" aria-modal="true" aria-labelledby="room-title"><form method="dialog"><header>
<h2 id="room-title">Afspil på</h2><button class="dialog-close" value="close" aria-label="Luk">
<img src="assets/icons/x-lg.svg" alt=""></button></header><p>Vælg højttaler til din musik.</p>
<div id="room-options"></div></form></dialog>`;

// The shell with the player's elements and the shell's own kit classes, as widget-view.js builds it.
export function playerShell() {
  document.body.innerHTML = PLAYER_SHELL;
  mountPlayerScreen(document);
  const $ = id => document.getElementById(id);
  applyKitTemplate($('music-detail'), 'detail');
  applyKitComponent($('empty-find-music'), 'button', {variant: 'secondary'});
  const rooms = $('rooms');
  applyKitDialog(rooms, {header: rooms.querySelector('header'), description: rooms.querySelector('p'),
    content: $('room-options'), close: rooms.querySelector('.dialog-close')});
  const host = document.querySelector('pv-widget-host');
  host.music = () => {};
  return host;
}

// Plain, writable fields on the host element (isConnected too, which tests turn off).
export function assign(host, fields) {
  for (const [key, value] of Object.entries(fields))
    Object.defineProperty(host, key, {value, configurable: true, writable: true, enumerable: true});
  return host;
}

// A PlayerView on a fresh shell; `host` fields are assigned onto the shell's host element.
export function mountPlayer({live = false, host: fields = {}, chooseQueue, seek} = {}) {
  const host = playerShell(), selected = [];
  assign(host, {live, ...fields});
  const view = new PlayerView(host, {chooseQueue: chooseQueue ?? (item => selected.push(item)), seek});
  return {host, view, selected, doc: document, $: id => document.getElementById(id)};
}

// A SpeakerOutputView on a fresh shell (the live shell's liveOutputs).
export function mountSpeakers(fields = {}) {
  const host = playerShell();
  assign(host, {isConnected: true, ...fields});
  const view = new SpeakerOutputView(host);
  host.liveOutputs = view;
  return {host, view, doc: document, $: id => document.getElementById(id)};
}

// A click as the user makes it: the browser drops it on a disabled control.
export const click = node => node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
