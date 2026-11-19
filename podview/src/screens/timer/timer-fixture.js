// Shared real-DOM fixture for the timer screen's Vitest suites (ported from the node:test fake DOM in
// tests/podview/root-timer-*.test.mjs). The shell is the part of podview/index.html the timer screen touches.
import {TimerView} from './TimerView';

export const TIMER_SHELL = `<nav class="view-nav"><span class="header-context"><button id="header-weather"></button>
</span></nav>
<section id="timers-view" class="response-widget timers-view" hidden></section>
<div id="timer-card" class="timer-overview"><div class="timer-active-list" hidden></div>
<button id="open-timers" class="timer-shortcut"><img src="assets/icons/timer.svg" alt="">
<span><strong>Timer</strong><small>Start en timer</small></span>
<img src="assets/icons/chevron-right.svg" alt=""></button></div>
<dialog id="timer-alert" class="timer-alert" aria-labelledby="timer-alert-name" aria-describedby="timer-alert-status"
 hidden>
 <span class="notice-icon" aria-hidden="true"><img src="assets/icons/timer.svg" alt=""></span>
 <div class="notice-copy"><small id="timer-alert-kicker"></small>
 <span id="timer-alert-name">Timeren er færdig</span>
 <strong>0:00</strong></div>
 <p id="timer-alert-status" role="status" hidden></p>
 <button id="timer-alert-add" class="timer-notice-add" hidden>+1 min</button>
 <button id="timer-alert-dismiss" class="timer-notice-close">Stop</button>
 <button id="timer-alert-open" class="timer-notice-open">Luk visning</button>
</dialog><p id="playback-status" hidden></p>`;

// A TimerView on a fresh shell. The old fixtures built the view without its alarm (Object.create on the
// prototype); `notice: false` keeps that, so only the suites that test the alarm get one.
export function mountTimer(host, {notice = false} = {}) {
  document.body.innerHTML = TIMER_SHELL;
  const view = new TimerView(host, document.getElementById('timers-view'), document.getElementById('timer-card'));
  if (!notice) {
    view.notice.cleanup();
    view.notice = undefined;
  }
  return view;
}

const label = node => {
  if (node?.nodeType !== 1) return '?';
  return `${node.localName}${node.id ? `#${node.id}` : ''}${node.classList[0] ? `.${node.classList[0]}` : ''}`;
};
const styles = text =>
  new Map(
    String(text || '')
      .split(';')
      .map(rule => rule.split(':'))
      .filter(pair => pair.length > 1)
      .map(([key, ...value]) => [key.trim(), value.join(':').trim()]),
  );
const dataKey = name => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

// Every DOM write under the document after this call, as the fake DOM named them: `<node>.textContent`,
// `<node>.data.<key>`, `<node>.style.<property>`, `<node>.attr.<name>`, `<node>.hidden`, `<node>.disabled` and
// `<node>.insert` for an inserted element. <node> is the tag, id and first class (`article.timer-panel`). Real
// mutations are observed, so a write of an unchanged attribute still counts; a text write (remove + add) counts
// once per node per batch. Reading or truncating the array collects pending records first.
export function recordWrites(root = document.body) {
  const rows = [];
  const observer = new MutationObserver(() => {});
  const options = {subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true};
  observer.observe(root, options);
  const collect = () => {
    const records = observer.takeRecords();
    const texts = new Set();
    const text = node => {
      if (texts.has(node)) return;
      texts.add(node);
      rows.push(`${label(node)}.textContent`);
    };
    records.forEach((record, index) => {
      const target = record.target;
      if (record.type === 'characterData') return text(target.parentNode);
      if (record.type === 'childList') {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.every(node => node.nodeType === 3)) text(target);
        else rows.push(`${label(target)}.insert`);
        return;
      }
      const name = record.attributeName;
      if (name === 'style') {
        const later = records.slice(index + 1).find(next => next.target === target && next.attributeName === 'style');
        const before = styles(record.oldValue);
        const after = styles(later ? later.oldValue : target.getAttribute('style'));
        const keys = [...new Set([...before.keys(), ...after.keys()])];
        const changed = keys.filter(key => before.get(key) !== after.get(key));
        if (!changed.length) rows.push(`${label(target)}.style`);
        for (const key of changed) rows.push(`${label(target)}.style.${key}`);
        return;
      }
      if (name.startsWith('data-')) rows.push(`${label(target)}.data.${dataKey(name)}`);
      else if (name === 'hidden' || name === 'disabled') rows.push(`${label(target)}.${name}`);
      else rows.push(`${label(target)}.attr.${name}`);
    });
  };
  return new Proxy(rows, {
    get(target, key, receiver) {
      collect();
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      collect();
      return Reflect.set(target, key, value, receiver);
    },
  });
}

// A click as the user makes it: the browser drops it on a disabled control, React's handler runs otherwise.
export const click = node => node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
