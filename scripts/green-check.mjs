#!/usr/bin/env node
// Green-tjek: fast regressionstjek mod den rigtige PodView på HA Green efter hver installation.
//
//   node scripts/green-check.mjs              lydløst tjek (altid tilladt)
//   node scripts/green-check.mjs --sound      + musikgrundtræk i Køkkenalrum, ≤10 %, kun kl. 08–18
//   node scripts/green-check.mjs rollback     viser, hvad der rulles tilbage (ændrer intet)
//   node scripts/green-check.mjs --help       alle valg
//
// Dækning af docs/BRUGERHISTORIER.md (103 historier). S = lydløst, L = med lyd (--sound), M = kun manuelt.
// | Område     | S (lydløst)        | L (--sound)      | M (manuelt, hvorfor)                                  |
// |------------|--------------------|------------------|-------------------------------------------------------|
// | Fælles G   | G1 G4              |                  | G2 G3 G5 G6 (dvale, race, visuel sammenligning)       |
// | Afspiller A|                    | A1 A2 A11        | A3–A10 A12–A14 (Spotify-app, stemme, touch, net, tid) |
// | Kø K       | K1 K7              | K3 K5            | K2 K4 K6 (sangskift, auto-fortsæt, dubletter)         |
// | Find mus. F| F1 F5 F11          | F2 F10           | F3 F4 F6–F9 F12 (idé, visuelt, AI, tid på dagen)      |
// | Højttaler H| H4 H6              | H1 (Køkkenalrum) | H2 H3 H5 H7–H10 (andre rum, konti, AirPlay, Tesla)    |
// | Radio R    | R3 R5              | R1 R2            | R4 R6 (fejlende stream, forkert opsætning)            |
// | Robot S    | S1 S12 S13         |                  | S2–S11 S14–S16 (fysisk robot får ingen kommandoer)    |
// | Lys L      |                    |                  | L1–L3 (lys må ikke styres)                            |
// | Opskrift O | O1                 |                  | O2–O10 (start og upload ændrer data)                  |
// | Timer T    |                    |                  | T1 T2 (start ændrer data, alarm giver lyd)            |
// | Vejr V     | V1 V4              |                  | V2 V3 (kræver fejlende kilde)                         |
// | Bil B      |                    |                  | B1–B11 (bilen røres aldrig, heller ikke dens side)    |
// | Svar Q     |                    |                  | Q1 Q2 (Voice PE-tale)                                 |
// I alt: 17 lydløst, 10 med lyd, 76 manuelt. Tværgående for alle sider: første billede uden
// indlæsning, ingen blink (MutationObserver/rAF), ingen stående fejltekst, ingen låste vælgere,
// forsidekort genopbygges ikke, ingen nye WARNING/ERROR i PodVoice-/PodConnect-/HA-loggen.
//
// Login: et langtidsholdbart HA-token, som brugeren selv opretter. Det læses fra $GREEN_HA_TOKEN eller
// macOS-nøgleringen (tjenesten "podvoice-green-check") og skrives aldrig ud eller til disk.
// Lydregler: kun Køkkenalrum, lydstyrke sættes til 8 % før afspilning, stop til sidst, aldrig 18–08.
// Robot, bil, lys og andre rum får aldrig en kommando. Tjekket trykker kun på læsende knapper uden --sound.

import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PERSISTENT_ERROR, flashes, isProblemLine, newLogLines, newSystemLogEntries, redact, rollbackBackup,
  soundAllowed, summary,
} from './green-check-lib.mjs';

const HELP = `Green-tjek for PodView på HA Green

Brug:
  node scripts/green-check.mjs [--sound] [--headed] [--out <mappe>]
  node scripts/green-check.mjs rollback [--yes] [--component <update.entitet>=<version>]

Tjek (lydløst):
  Hver side (forside, afspiller, kø, Find musik og faner, radio, robot, vejr, opskrifter) viser indhold i
  første billede efter navigation; ingen knap blinker; ingen stående "afvist"/"ukendt udfald"/"kunne ikke
  genskabes"; højttalervælger, kø og Find musik er aldrig låst; robotten viser sidste opsætning; forsidekort
  genopbygges ikke; ingen nye WARNING/ERROR i PodVoice-, PodConnect- og HA-loggen (undtagen kendt liste).
--sound (kun 08–18, kun Køkkenalrum, lydstyrke 8 %):
  kold start → afspil fra køen → pause → afspil → vælg højttaler → start fra Find musik → radio → stop.
  HA-tilstanden tjekkes efter hvert trin, og Køkkenalrum sættes på pause til sidst, også ved fejl.

Login:
  Opret i HA: Profil → Sikkerhed → Langtidsholdbare adgangstokens → "green-check", kopiér det, og gem det
  i nøgleringen direkte fra udklipsholderen (prompten i "security -w" klipper ved 128 tegn):
    security add-generic-password -U -a "$USER" -s podvoice-green-check -w "$(pbpaste)"
  Ryd derefter udklipsholderen. Alternativt GREEN_HA_TOKEN. Tokenet skrives aldrig ud.
Miljø:
  GREEN_HA_URL      (standard http://homeassistant.lan:8123)
  GREEN_PANEL       PodVoice-panelets sti (standard 23375871_podvoice/view)

Tilbagerulning (rollback):
  Når et grønt tjek er gennemført, gemmes de installerede versioner i
  ~/.config/podvoice/green-check-last-green.json (ingen hemmeligheder).
  "rollback" viser planen uden at ændre noget:
    - add-ons (PodVoice, PodConnect Speakers): gendanner den delvise backup, som update.install med
      backup: true lavede før den nuværende version (Supervisor-navn "<navn> <version>", fx "PodVoice 2.0.188").
    - HA-komponenter (PodVoice, PodConnect Control): update.install med version fra sidste grønne tjek
      eller --component update.x=1.2.3. Kræver HA-genstart, som kun sker kl. 08–18.
  "rollback --yes" udfører planen.

Exitkode 0 = grøn, 1 = rød, 2 = kunne ikke køre (fx manglende token).`;

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const BASE = (process.env.GREEN_HA_URL || 'http://homeassistant.lan:8123').replace(/\/$/, '');
const PANEL = (process.env.GREEN_PANEL || '23375871_podvoice/view').replace(/^\//, '');
const LAST_GREEN = path.join(os.homedir(), '.config', 'podvoice', 'green-check-last-green.json');
const KITCHEN = /Køkkenalrum/i;
let SECRET = null; // set once in main(); only used to redact error text
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function readToken() {
  if (process.env.GREEN_HA_TOKEN) return process.env.GREEN_HA_TOKEN.trim();
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'podvoice-green-check', '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function loadPlaywright() {
  const require = createRequire(new URL('../tests/browser/package.json', import.meta.url));
  try {
    return require('playwright');
  } catch {
    console.error('Playwright mangler. Kør først: npm ci --prefix tests/browser');
    process.exit(2);
  }
}

// ---------- Home Assistant ----------

function haClient(token) {
  const rest = async (method, route, body) => {
    const response = await fetch(BASE + route, {
      method,
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HA ${method} ${route.split('?')[0]} gav ${response.status}`);
    return (response.headers.get('content-type') || '').includes('json') ? response.json() : response.text();
  };
  return {
    get: route => rest('GET', route),
    post: (route, body) => rest('POST', route, body ?? {}),
    state: entityId => rest('GET', `/api/states/${entityId}`),
    service: (domain, service, data) => rest('POST', `/api/services/${domain}/${service}`, data),
  };
}

// WebSocket calls go through Home Assistant's own frontend connection in the browser page.
const callWS = (page, message) =>
  page.evaluate(async msg => {
    for (let n = 0; n < 150; n++) {
      const hass = document.querySelector('home-assistant')?.hass;
      if (hass?.connection) return hass.callWS(msg);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Home Assistant-frontenden blev ikke klar');
  }, message);

const supervisor = (page, endpoint, method = 'get', data) =>
  callWS(page, {type: 'supervisor/api', endpoint, method, ...(data ? {data} : {}), timeout: null});

async function ourAddons(page) {
  const {addons} = await supervisor(page, '/addons');
  const pick = re => addons.find(a => re.test(a.name || '') && a.installed !== false) || null;
  return [
    ['PodVoice', pick(/podvoice/i)],
    ['PodConnect Speakers', pick(/podconnect|speakers/i)],
  ].filter(([, addon]) => addon);
}

// HA components (PodVoice, PodConnect Control) are update entities that Supervisor does not own.
async function ourComponents(page, ha) {
  const registry = await callWS(page, {type: 'config/entity_registry/list'});
  const ids = new Set(
    registry
      .filter(e => e.entity_id.startsWith('update.') && e.platform !== 'hassio')
      .filter(e => /podvoice|podconnect/i.test(e.entity_id))
      .map(e => e.entity_id),
  );
  return (await ha.get('/api/states')).filter(s => ids.has(s.entity_id));
}

async function readLogs(page, ha, addons) {
  const out = {addons: {}, errors: []};
  for (const [name, addon] of addons) {
    try {
      out.addons[name] = String(await ha.get(`/api/hassio/addons/${addon.slug}/logs`));
    } catch (error) {
      out.errors.push(`${name}-loggen kunne ikke læses (${error.message})`);
    }
  }
  try {
    out.system = await callWS(page, {type: 'system_log/list'});
  } catch (error) {
    out.errors.push(`HA-loggen kunne ikke læses (${error.message})`);
  }
  return out;
}

// ---------- In-page instrumentation (runs inside the PodView frame) ----------

function installProbe() {
  if (window.__gc) return;
  const CONTROLS = 'button, input, select, [role=button], [role=switch], [role=tab]';
  const CARDS = '.resource-card, .resource-preview, [id^="home-"]';
  const host = () => document.querySelector('pv-widget-host');
  const shown = el => {
    if (!el.isConnected || el.closest('[hidden], [inert]')) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) return false;
    if (rect.right < 0 || rect.left > innerWidth) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const ids = new WeakMap();
  let counter = 0;
  const keyOf = el => {
    if (!ids.has(el)) {
      const label = (el.getAttribute('aria-label') || el.textContent || el.name || '').replace(/\s+/g, ' ').trim();
      const id = el.id ? `#${el.id}` : el.dataset.actionId ? `[${el.dataset.actionId}]` : el.tagName.toLowerCase();
      ids.set(el, `${id} «${label.slice(0, 32)}» (${++counter})`);
    }
    return ids.get(el);
  };
  const digits = text => String(text || '').replace(/\s+/g, ' ').trim().replace(/\d+([.,:]\d+)*/g, '#');
  const signature = el => {
    if (!shown(el)) return 'skjult';
    const parts = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('låst');
    if (el.getAttribute('aria-busy') === 'true') parts.push('arbejder');
    if (el.matches('input[type=checkbox], input[type=radio]')) parts.push(el.checked ? 'valgt' : 'fravalgt');
    for (const name of ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current'])
      if (el.hasAttribute(name)) parts.push(`${name}=${el.getAttribute(name)}`);
    if (!el.matches('input, select')) parts.push(digits(el.getAttribute('aria-label') || el.textContent).slice(0, 40));
    return parts.join('|') || 'normal';
  };
  const loadingText = /\b(Henter|Indlæser|Opdaterer)\b[^.\n]{0,40}/;
  const snapshot = () => {
    let text = 0;
    const loading = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue.trim();
      if (!value || !node.parentElement || !shown(node.parentElement)) continue;
      text += value.length;
      const match = value.match(loadingText);
      if (match) loading.push(match[0]);
    }
    for (const el of document.querySelectorAll('[aria-busy="true"], .skeleton, [data-content-state="pending"]'))
      if (shown(el)) loading.push(`travl: ${keyOf(el)}`);
    const controls = [...document.querySelectorAll(CONTROLS)].filter(shown);
    return {focus: host()?.state?.focus ?? null, text, controls: controls.length, loading};
  };
  const visibleText = () => {
    const parts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.nodeValue.trim() && node.parentElement && shown(node.parentElement)) parts.push(node.nodeValue.trim());
    return parts.join(' · ');
  };
  let win = null;
  const sample = () => {
    if (!win) return;
    for (const el of document.querySelectorAll(CONTROLS)) {
      const key = keyOf(el);
      const value = signature(el);
      const seq = win.history[key];
      if (!seq) {
        if (value !== 'skjult') win.history[key] = [value];
      } else if (seq.at(-1) !== value) seq.push(value);
    }
    if (++win.frames % 3 === 0) for (const item of snapshot().loading) win.loading.add(item);
    win.raf = requestAnimationFrame(sample);
  };
  const observer = new MutationObserver(records => {
    if (!win?.watchCards) return;
    for (const record of records)
      for (const node of record.removedNodes)
        if (node.nodeType === 1 && (node.matches(CARDS) || node.querySelector(CARDS)))
          win.cardsRemoved.push(node.id || node.className || node.tagName);
  });
  observer.observe(document.body, {childList: true, subtree: true});
  window.__gc = {
    snapshot,
    visibleText,
    focus: () => host()?.state?.focus ?? null,
    begin(watchCards = false) {
      if (win) cancelAnimationFrame(win.raf);
      win = {history: {}, loading: new Set(), cardsRemoved: [], frames: 0, watchCards};
      sample();
    },
    end() {
      if (!win) return null;
      cancelAnimationFrame(win.raf);
      const result = {history: win.history, loading: [...win.loading], cardsRemoved: win.cardsRemoved};
      win = null;
      return result;
    },
    // Resolves in the first animation frame where the page has changed.
    waitFocus(before, timeout) {
      const start = performance.now();
      return new Promise(resolve => {
        const tick = () => {
          const now = host()?.state?.focus ?? null;
          if (now !== before) return resolve({ms: Math.round(performance.now() - start), ...snapshot()});
          if (performance.now() - start > timeout) return resolve(null);
          requestAnimationFrame(tick);
        };
        tick();
      });
    },
    locked(selector) {
      return [...document.querySelectorAll(selector)]
        .filter(el => shown(el) && (el.disabled || el.getAttribute('aria-disabled') === 'true'))
        .map(keyOf);
    },
  };
}

// ---------- The check ----------

class Check {
  constructor(page, frame, out) {
    this.page = page;
    this.frame = frame;
    this.out = out;
    this.results = [];
    this.ownLogLines = [];
  }

  record(id, stories, status, detail = '') {
    this.results.push({id, stories, status, detail});
    const mark = {ok: '✓', fejl: '✗', sprunget: '–'}[status];
    console.log(`${mark} ${id} (${stories})${detail ? ': ' + detail : ''}`);
  }

  async shot(name) {
    try {
      await this.page.screenshot({path: path.join(this.out, `${name.replace(/[^\w-]+/g, '-')}.png`)});
    } catch {}
  }

  gc(fn, arg) {
    return this.frame.evaluate(([body, value]) => window.__gc[body](value), [fn, arg]);
  }

  async focus() {
    return this.frame.evaluate(() => window.__gc.focus());
  }

  async home() {
    for (let n = 0; n < 8; n++) {
      const focus = await this.focus();
      if (focus === 'now') return;
      if (await this.frame.locator('dialog[open]').count()) {
        await this.page.keyboard.press('Escape');
      } else if (focus === 'photo') {
        await this.frame.locator('#photo-view').tap();
      } else {
        await this.frame.locator('#header-title-action').tap();
      }
      await sleep(900);
    }
    throw new Error('kom ikke tilbage til forsiden');
  }

  // Opens a page with a real tap and measures it: first frame, content arriving later, flashes,
  // and error text that is still there seconds later.
  async visit(id, stories, opener, {extra, reopen = false} = {}) {
    const problems = [];
    try {
      await this.home();
      const before = await this.focus();
      const target = this.frame.locator(opener).first();
      await target.waitFor({state: 'visible', timeout: 8000});
      await this.gc('begin', false);
      await target.tap();
      const first = await this.gc('waitFocus', before, 4000);
      if (!first) throw new Error('siden åbnede ikke inden for 4 s');
      await sleep(400);
      const settled = await this.gc('snapshot');
      await sleep(2600);
      const later = await this.gc('snapshot');
      const window = await this.gc('end');
      const loading = [...new Set([...first.loading, ...settled.loading, ...window.loading])];
      if (loading.length) problems.push(`indlæsning synlig: ${loading.slice(0, 4).join(', ')}`);
      const grew = later.controls - settled.controls >= 3 ||
        (later.text > settled.text * 1.4 && later.text - settled.text > 80);
      if (grew)
        problems.push(
          `indhold kom ind efter første billede (knapper ${settled.controls}→${later.controls}, ` +
            `tekst ${settled.text}→${later.text} tegn)`,
        );
      const flash = flashes(window.history, 1);
      if (flash.length) problems.push(`blink: ${describeFlashes(flash)}`);
      if (extra) problems.push(...(await extra()));
      const error = await this.persistentError();
      if (error) problems.push(`stående fejltekst: "${error}"`);
    } catch (error) {
      problems.push(error.message);
    }
    if (problems.length) await this.shot(id);
    this.record(id + (reopen ? ' (genåbnet)' : ''), stories, problems.length ? 'fejl' : 'ok', problems.join('; '));
  }

  async persistentError() {
    const pattern = new RegExp(`[^·]{0,60}(${PERSISTENT_ERROR.source})[^·]{0,60}`, 'i');
    const read = async () => (await this.gc('visibleText')).match(pattern);
    if (!(await read())) return null;
    await sleep(3000);
    return (await read())?.[0]?.trim() || null;
  }

  async locked(selector) {
    return this.gc('locked', selector);
  }
}

function describeFlashes(found) {
  return found
    .slice(0, 3)
    .map(f => `${f.control}: ${f.changes.map(c => c || 'normal').join(' → ')}`)
    .join(' | ') + (found.length > 3 ? ` (+${found.length - 3} flere)` : '');
}

async function openPodView(page) {
  await page.goto(`${BASE}/${PANEL}`, {waitUntil: 'domcontentloaded', timeout: 30000});
  for (let n = 0; n < 200; n++) {
    if (/\/auth\/authorize/.test(page.url()))
      throw new Error('HA viste loginsiden: tokenet blev ikke accepteret (se --help under Login)');
    for (const frame of page.frames()) {
      if (!/\/api\/hassio_ingress\//.test(frame.url())) continue;
      if (await frame.locator('pv-widget-host').count().catch(() => 0)) {
        await frame.evaluate(installProbe);
        return frame;
      }
    }
    await sleep(150);
  }
  throw new Error('PodView-rammen blev ikke fundet i HA-panelet');
}

async function silentChecks(check) {
  const {frame} = check;
  // G1: opens on the HA login alone and connects without setup or refresh.
  const connected = await frame
    .waitForFunction(() => {
      const host = document.querySelector('pv-widget-host');
      return host?.live && host.liveTransport?.connected;
    }, null, {timeout: 20000})
    .then(() => true, () => false);
  check.record('opstart', 'G1', connected ? 'ok' : 'fejl', connected ? '' : 'PodView fik ikke forbindelse inden 20 s');
  await check.home();

  // Home cards: stay 20 s while updates arrive; nothing may flash, load or be rebuilt.
  await check.gc('begin', true);
  await sleep(20000);
  const idle = await check.gc('end');
  const home = [];
  if (idle.cardsRemoved.length) home.push(`forsidekort genopbygget: ${[...new Set(idle.cardsRemoved)].join(', ')}`);
  const homeFlash = flashes(idle.history, 1);
  if (homeFlash.length) home.push(`blink: ${describeFlashes(homeFlash)}`);
  if (idle.loading.length) home.push(`indlæsning synlig: ${idle.loading.slice(0, 3).join(', ')}`);
  const homeError = await check.persistentError();
  if (homeError) home.push(`stående fejltekst: "${homeError}"`);
  if (home.length) await check.shot('forside');
  check.record('forside i ro 20 s', 'S12 V1', home.length ? 'fejl' : 'ok', home.join('; '));

  const picker = async () => {
    const problems = [];
    const output = frame.locator('#output');
    if (!(await output.isVisible())) return ['højttalervælgeren (#output) vises ikke'];
    const lockedOutput = await check.locked('#output');
    if (lockedOutput.length) return ['højttalervælgeren er låst'];
    await output.tap();
    const options = frame.locator('#room-options button');
    const opened = await options.first().waitFor({state: 'visible', timeout: 3000}).then(() => true, () => false);
    if (!opened) problems.push('højttalerlisten åbnede ikke');
    else {
      const locked = await check.locked('#room-options button');
      if (locked.length) problems.push(`højttalere låst: ${locked.join(', ')}`);
      const text = await frame.locator('#room-options').innerText().catch(() => '');
      if (/ukendt udfald|afvist/i.test(text)) problems.push(`højttalerlisten siger: ${text.split('\n')[0]}`);
    }
    await check.page.keyboard.press('Escape');
    await sleep(500);
    return problems;
  };
  const queue = async () => {
    const problems = [];
    const list = frame.locator('#queue');
    if (!(await list.isVisible())) return ['køen vises ikke i afspilleren'];
    const rows = await frame.locator('#queue button').count();
    const empty = await frame.locator('#queue .queue-empty').count();
    if (!rows && !empty) problems.push('køen er tom uden forklaring');
    const locked = await check.locked('#queue button');
    if (locked.length) problems.push(`kø-rækker låst: ${locked.slice(0, 3).join(', ')}`);
    return problems;
  };
  // On the iPad layout the player sits on the home page; #track opens its own view only while music plays.
  await check.home();
  if (await frame.locator('#track:not([disabled])').isVisible()) {
    await check.visit('afspiller + kø', 'K1 H6', '#track', {
      extra: async () => [...(await queue()), ...(await picker())],
    });
    await check.visit('afspiller + kø', 'K7', '#track', {reopen: true, extra: queue});
  } else {
    const problems = await picker();
    if (await frame.locator('#queue').isVisible()) problems.push(...(await queue()));
    if (problems.length) await check.shot('afspiller');
    const note = 'tom afspiller på forsiden; køen tjekkes med --sound';
    check.record('afspiller + højttalervælger', 'H4 H6', problems.length ? 'fejl' : 'ok',
      problems.length ? problems.join('; ') : note);
  }
  await check.visit('Find musik', 'F1 F11', '#home-music', {extra: () => findMusicLocks(check)});
  await findMusicTabs(check);
  await check.visit('radio', 'R3 R5', '#home-radio', {
    extra: async () => {
      const locked = await check.locked('#radio-view pv-choice-list button');
      const total = await frame.locator('#radio-view pv-choice-list button').count();
      return [
        ...(total ? [] : ['ingen radiokanaler vises']),
        ...(locked.length && locked.length === total ? ['alle radiokanaler er låst'] : []),
      ];
    },
  });
  const robot = async () => {
    await sleep(1500);
    const locked = (await check.locked('pv-robot-control-panel :is(button, input)')).filter(
      key => !/\[(pause|resume)\]/.test(key),
    );
    const text = await frame.locator('pv-robot-control-panel').innerText().catch(() => '');
    return [
      ...(text ? [] : ['robotpanelet vises ikke']),
      ...(locked.length ? [`robotknapper låst: ${locked.slice(0, 3).join(', ')}`] : []),
    ];
  };
  await check.visit('robot', 'S1 S12 S13', '.resource-preview[data-kind="vacuum"]', {extra: robot});
  await check.visit('robot', 'S1 S13', '.resource-preview[data-kind="vacuum"]', {extra: robot, reopen: true});
  await check.visit('vejr', 'V4', '#home-weather');
  await check.visit('opskrifter', 'O1', '#home-recipes');
  await check.visit('opskrifter', 'G4', '#home-recipes', {reopen: true});
  await check.home();
}

async function findMusicLocks(check) {
  const locked = await check.locked('#result-list button');
  const total = await check.frame.locator('#result-list button').count();
  if (!total) return ['Find musik viser ingen forslag'];
  return locked.length ? [`Find musik-forslag låst: ${locked.length} af ${total}`] : [];
}

// F5: switching between the Find musik tabs shows known content at once, without loading or locks.
async function findMusicTabs(check) {
  const {frame} = check;
  const problems = [];
  try {
    await check.home();
    await frame.locator('#home-music').tap();
    await frame.locator('[data-collection]').first().waitFor({state: 'visible', timeout: 5000});
    const tabs = await frame.locator('[data-collection]').evaluateAll(nodes =>
      [...new Set(nodes.map(n => n.dataset.collection))]);
    for (const tab of [...tabs, ...tabs]) {
      await check.gc('begin', false);
      await frame.locator(`[data-collection="${tab}"]`).first().tap();
      await sleep(1500);
      const window = await check.gc('end');
      if (window.loading.length) problems.push(`${tab}: indlæsning synlig (${window.loading[0]})`);
      const flash = flashes(window.history, 1);
      if (flash.length) problems.push(`${tab}: blink ${describeFlashes(flash)}`);
      problems.push(...(await findMusicLocks(check)).map(p => `${tab}: ${p}`));
    }
  } catch (error) {
    problems.push(error.message);
  }
  const unique = [...new Set(problems)];
  if (unique.length) await check.shot('find-musik-faner');
  check.record('Find musik faner', 'F5', unique.length ? 'fejl' : 'ok', unique.join('; '));
}

// ---------- Sound ----------

async function kitchenPlayer(page, ha) {
  const registry = await callWS(page, {type: 'config/entity_registry/list'});
  const states = await ha.get('/api/states');
  const players = states.filter(s => s.entity_id.startsWith('media_player.'));
  const podconnect = new Set(registry.filter(e => e.platform === 'podconnect').map(e => e.entity_id));
  // Control's hidden engine entity follows whichever room plays; it is not another room.
  const hidden = new Set(registry.filter(e => e.platform === 'podconnect' && e.hidden_by).map(e => e.entity_id));
  const ours = players.filter(s => podconnect.has(s.entity_id) && !hidden.has(s.entity_id));
  const kitchen = ours.find(s => KITCHEN.test(s.attributes.friendly_name || '')) ||
    players.find(s => KITCHEN.test(s.attributes.friendly_name || ''));
  const others = ours.map(s => s.entity_id).filter(id => id !== kitchen?.entity_id);
  return {kitchen: kitchen?.entity_id || null, others};
}

async function waitState(ha, entityId, predicate, timeout = 6000) {
  const start = Date.now();
  let state;
  while (Date.now() - start < timeout) {
    state = await ha.state(entityId);
    if (predicate(state)) return {ok: true, state, ms: Date.now() - start};
    await sleep(300);
  }
  return {ok: false, state, ms: Date.now() - start};
}

async function soundChecks(check, ha) {
  if (!soundAllowed()) {
    check.record('lyd', 'A1 A2 H1 R1 R2', 'sprunget', 'lyd er kun tilladt kl. 08–18');
    return;
  }
  const {kitchen, others} = await kitchenPlayer(check.page, ha);
  if (!kitchen) {
    check.record('lyd', 'A1 A2 H1 R1 R2', 'fejl', 'Køkkenalrum-afspilleren blev ikke fundet i HA');
    return;
  }
  const busy = [];
  for (const id of others) if ((await ha.state(id)).state === 'playing') busy.push(id);
  if (busy.length) {
    check.record('lyd', 'A1 A2 H1 R1 R2', 'sprunget', `${busy.join(', ')} spiller; rører den ikke`);
    return;
  }
  const quiet = () => ha.service('media_player', 'volume_set', {entity_id: kitchen, volume_level: 0.08});
  const guard = async () => {
    const state = await ha.state(kitchen);
    if ((state.attributes.volume_level ?? 0) > 0.1) {
      await ha.service('media_player', 'media_pause', {entity_id: kitchen});
      throw new Error(`lydstyrken var ${Math.round(state.attributes.volume_level * 100)} %; sat på pause`);
    }
    for (const id of others)
      if ((await ha.state(id)).state === 'playing') {
        await ha.service('media_player', 'media_pause', {entity_id: id});
        throw new Error(`${id} begyndte at spille; sat på pause med det samme`);
      }
  };
  const step = async (id, stories, body) => {
    try {
      const problems = (await body()) || [];
      if (problems.length) await check.shot(`lyd-${id}`);
      check.record(`lyd: ${id}`, stories, problems.length ? 'fejl' : 'ok', problems.join('; '));
      return !problems.length;
    } catch (error) {
      await check.shot(`lyd-${id}`);
      check.record(`lyd: ${id}`, stories, 'fejl', error.message);
      return false;
    }
  };
  const playing = () => waitState(ha, kitchen, s => s.state === 'playing');
  const notPlaying = () => waitState(ha, kitchen, s => s.state !== 'playing');
  const unlocked = async () => {
    const problems = [];
    for (const [name, selector] of [['højttalervælger', '#output'], ['kø', '#queue button']]) {
      const locked = await check.locked(selector);
      if (locked.length) problems.push(`${name} låst`);
    }
    const error = await check.persistentError();
    if (error) problems.push(`stående fejltekst: "${error}"`);
    return problems;
  };
  const openPlayer = async () => {
    if ((await check.focus()) === 'player') return;
    await check.home();
    const track = check.frame.locator('#track:not([disabled])');
    if (!(await track.isVisible())) return; // empty player: it is on the home page
    await track.tap();
    await check.frame.locator('#play-pause').waitFor({state: 'visible', timeout: 5000});
  };
  const tapWatched = async (selector, after) => {
    await check.gc('begin', false);
    await check.frame.locator(selector).first().tap();
    const result = await after();
    const window = await check.gc('end');
    const flash = flashes(window.history, 1);
    return {result, flash};
  };

  // The volume must be at most 10 % before the first sound. If the speaker refuses a volume change
  // while it is quiet, no sound is made at all.
  try {
    await quiet();
  } catch {
    // The refused volume call is our own; its log lines are not a product regression.
    check.ownLogLines.push(/volume failed|Native route unavailable/i);
  }
  const level = (await waitState(ha, kitchen, s => (s.attributes.volume_level ?? 1) <= 0.1, 4000)).state;
  if ((level?.attributes?.volume_level ?? 1) > 0.1) {
    const percent = Math.round((level?.attributes?.volume_level ?? 1) * 100);
    check.record('lyd', 'A1 A2 H1 R1 R2', 'sprunget',
      `${kitchen} kan ikke sættes til ≤10 % før afspilning (står på ${percent} %); ingen lyd afspillet`);
    return;
  }
  try {
    if ((await ha.state(kitchen)).state === 'playing') {
      await ha.service('media_player', 'media_pause', {entity_id: kitchen});
      await notPlaying();
    }
    await step('kold start', 'H4', async () => {
      await check.page.reload({waitUntil: 'domcontentloaded'});
      check.frame = await openPodView(check.page);
      await check.home();
      await openPlayer();
      const room = await check.frame.locator('#player-room, #output').first().innerText().catch(() => '');
      return KITCHEN.test(room) ? [] : [`afspilleren står ikke på Køkkenalrum (${room.trim() || 'tom'})`];
    });
    const f = () => check.frame;
    await step('afspil fra kø', 'K3 K5 A11', async () => {
      await openPlayer();
      let row = f().locator('#queue button.queue-track:not([data-current="true"])').first();
      if (!(await row.count())) {
        // Cold start with an empty player: start something from Find musik so there is a queue.
        await check.home();
        await f().locator('#home-music').tap();
        const choice = f().locator('#result-list button.result:not([disabled])').first();
        await choice.waitFor({state: 'visible', timeout: 8000});
        await quiet();
        await choice.tap();
        const first = await waitState(ha, kitchen, s => s.state === 'playing', 8000);
        await guard();
        if (!first.ok) return ['kold start fra Find musik spillede ikke på Køkkenalrum inden 8 s'];
        await sleep(3000);
        await openPlayer();
        row = f().locator('#queue button.queue-track:not([data-current="true"])').first();
        await row.waitFor({state: 'visible', timeout: 6000}).catch(() => {});
        if (!(await row.count())) return ['køen viser ingen kommende sange efter start'];
      }
      await quiet();
      const {result, flash} = await tapWatched('#queue button.queue-track:not([data-current="true"])', playing);
      await guard();
      await sleep(1500);
      return [
        ...(result.ok ? [] : [`Køkkenalrum spillede ikke efter 6 s (${result.state?.state})`]),
        ...(flash.length ? [`blink: ${describeFlashes(flash)}`] : []),
        ...(await unlocked()),
      ];
    });
    await step('pause', 'A1', async () => {
      await openPlayer();
      const {result, flash} = await tapWatched('#play-pause', notPlaying);
      return [
        ...(result.ok ? [] : ['musikken stoppede ikke inden 6 s']),
        ...(flash.length ? [`blink: ${describeFlashes(flash)}`] : []),
        ...(await unlocked()),
      ];
    });
    await step('afspil', 'A2', async () => {
      await quiet();
      const {result, flash} = await tapWatched('#play-pause', playing);
      await guard();
      return [
        ...(result.ok ? [] : ['musikken startede ikke igen inden 6 s']),
        ...(flash.length ? [`blink: ${describeFlashes(flash)}`] : []),
        ...(await unlocked()),
      ];
    });
    await step('vælg højttaler Køkkenalrum', 'H1 H6', async () => {
      await openPlayer();
      if ((await check.locked('#output')).length) return ['højttalervælgeren er låst'];
      await f().locator('#output').tap();
      const option = f().locator('#room-options button').filter({hasText: KITCHEN});
      await option.first().waitFor({state: 'visible', timeout: 4000});
      if ((await check.locked('#room-options button')).length) return ['højttalere i listen er låst'];
      await option.first().tap();
      await sleep(2500);
      await guard();
      const room = await f().locator('#output').innerText().catch(() => '');
      const state = await ha.state(kitchen);
      return [
        ...(KITCHEN.test(room) ? [] : [`afspilleren viser ikke Køkkenalrum (${room.trim()})`]),
        ...(state.state === 'playing' ? [] : [`Køkkenalrum spiller ikke efter valget (${state.state})`]),
        ...(await unlocked()),
      ];
    });
    await step('start fra Find musik', 'F2 F10', async () => {
      const title = (await ha.state(kitchen)).attributes.media_title;
      await check.home();
      await f().locator('#home-music').tap();
      const choice = f().locator('#result-list button.result:not([disabled])');
      await choice.first().waitFor({state: 'visible', timeout: 5000});
      await quiet();
      await choice.first().tap();
      const started = s => s.state === 'playing' && s.attributes.media_title !== title;
      const result = await waitState(ha, kitchen, started, 8000);
      await guard();
      return [
        ...(result.ok ? [] : [`ny musik startede ikke på Køkkenalrum inden 8 s (${result.state?.state})`]),
        ...(await unlocked()),
      ];
    });
    await step('radio på valgt højttaler', 'R1', async () => {
      await check.home();
      await f().locator('#home-radio').tap();
      const station = f().locator('#radio-view pv-choice-list button:not([disabled])');
      await station.first().waitFor({state: 'visible', timeout: 5000});
      await quiet();
      await station.first().tap();
      const result = await waitState(ha, kitchen, s => s.state === 'playing', 8000);
      await sleep(1500);
      await guard();
      const output = await f().locator('#output').innerText().catch(() => '');
      return [
        ...(result.ok ? [] : ['radioen spillede ikke på Køkkenalrum inden 8 s']),
        ...(output && !KITCHEN.test(output) ? [`radioen viser en anden højttaler (${output.trim()})`] : []),
      ];
    });
    await step('stop', 'R2', async () => {
      const stop = f().locator('#play-pause');
      if (await stop.isVisible()) await stop.tap();
      const result = await notPlaying();
      return result.ok ? [] : ['radioen stoppede ikke inden 6 s'];
    });
  } finally {
    try {
      if ((await ha.state(kitchen)).state === 'playing')
        await ha.service('media_player', 'media_pause', {entity_id: kitchen});
    } catch {}
  }
}

// ---------- Logs ----------

function logResults(check, before, after, startedAt) {
  const problems = [...after.errors];
  for (const [name, text] of Object.entries(after.addons)) {
    const fresh = newLogLines(before.addons[name] || '', text)
      .filter(line => isProblemLine(line) && !check.ownLogLines.some(rule => rule.test(line)));
    if (fresh.length) problems.push(`${name}: ${fresh.length} nye linjer, fx "${fresh[0].slice(0, 160)}"`);
  }
  if (after.system) {
    const fresh = newSystemLogEntries(after.system, startedAt).filter(
      entry => !check.ownLogLines.some(rule => rule.test([].concat(entry.message).join(' '))),
    );
    if (fresh.length) {
      const first = fresh[0];
      problems.push(`HA: ${fresh.length} nye, fx ${first.name}: "${[].concat(first.message)[0]?.slice(0, 160)}"`);
    }
  }
  check.record('logge under kørslen', 'alle', problems.length ? 'fejl' : 'ok', problems.join('; '));
}

// ---------- Rollback ----------

async function rollback(page, ha) {
  const execute = flag('--yes');
  const lastGreen = fs.existsSync(LAST_GREEN) ? JSON.parse(fs.readFileSync(LAST_GREEN, 'utf8')) : null;
  const {backups} = await supervisor(page, '/backups');
  const plan = [];
  for (const [name, addon] of await ourAddons(page)) {
    const backup = rollbackBackup(backups, addon);
    const wanted = lastGreen?.addons?.[addon.slug];
    if (!backup) plan.push({name, note: `ingen update-backup fundet (installeret ${addon.version})`});
    else if (wanted && backup.version !== wanted && addon.version === wanted)
      plan.push({name, note: `allerede på sidste grønne version ${wanted}`});
    else {
      const note = `${addon.version} → ${backup.version} fra "${backup.name}" (${backup.date})`;
      plan.push({name, addon, backup, note});
    }
  }
  const requested = Object.fromEntries(
    args.filter((a, i) => args[i - 1] === '--component').map(a => a.split('=')),
  );
  for (const entity of await ourComponents(page, ha)) {
    const installed = entity.attributes.installed_version;
    const wanted = requested[entity.entity_id] || lastGreen?.components?.[entity.entity_id];
    if (!wanted) plan.push({name: entity.entity_id, note: `ingen kendt grøn version (installeret ${installed})`});
    else if (wanted === installed) plan.push({name: entity.entity_id, note: `allerede ${installed}`});
    else {
      const note = `${installed} → ${wanted}`;
      plan.push({name: entity.entity_id, component: entity.entity_id, version: wanted, note});
    }
  }
  console.log(lastGreen ? `Sidste grønne tjek: ${lastGreen.at}` : 'Ingen sidste grønne tjek gemt endnu.');
  for (const item of plan) console.log(`- ${item.name}: ${item.note}`);
  if (!execute) {
    console.log('\nIntet er ændret. Kør med --yes for at rulle tilbage.');
    return 0;
  }
  let restart = false;
  for (const item of plan) {
    if (item.backup) {
      console.log(`Gendanner ${item.name} …`);
      await supervisor(page, `/backups/${item.backup.slug}/restore/partial`, 'post', {addons: [item.addon.slug]});
    }
    if (item.component) {
      console.log(`Installerer ${item.name} ${item.version} …`);
      await ha.service('update', 'install', {entity_id: item.component, version: item.version, backup: false});
      restart = true;
    }
  }
  if (restart) {
    if (soundAllowed()) {
      console.log('Genstarter Home Assistant for at indlæse komponenten …');
      await ha.service('homeassistant', 'restart', {});
    } else console.log('Komponenten kræver en HA-genstart. Den må først ske kl. 08–18 (kan genoptage lyd).');
  }
  console.log('Tilbagerulning sendt. Kør green-check igen bagefter.');
  return 0;
}

async function rememberGreen(page, ha) {
  const addons = Object.fromEntries((await ourAddons(page)).map(([, a]) => [a.slug, a.version]));
  const components = Object.fromEntries(
    (await ourComponents(page, ha)).map(s => [s.entity_id, s.attributes.installed_version]),
  );
  fs.mkdirSync(path.dirname(LAST_GREEN), {recursive: true});
  fs.writeFileSync(LAST_GREEN, JSON.stringify({at: new Date().toISOString(), addons, components}, null, 2));
  return {addons, components};
}

// ---------- Main ----------

async function main() {
  if (flag('--help') || flag('-h')) {
    console.log(HELP);
    return 0;
  }
  const token = readToken();
  SECRET = token;
  if (!token) {
    console.error('Intet HA-token. Se "node scripts/green-check.mjs --help" under Login.');
    return 2;
  }
  const {chromium} = loadPlaywright();
  const out = option('--out') || fs.mkdtempSync(path.join(os.tmpdir(), 'green-check-'));
  fs.mkdirSync(out, {recursive: true});
  const ha = haClient(token);
  try {
    await ha.get('/api/');
  } catch (error) {
    console.error(`HA afviste tokenet eller svarede ikke (${error.message}). Se --help under Login.`);
    return 2;
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: !flag('--headed'),
    ...(process.env.PODVIEW_TEST_CHROMIUM ? {executablePath: process.env.PODVIEW_TEST_CHROMIUM}
      : process.platform === 'darwin' && fs.existsSync(mac) ? {executablePath: mac} : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: {width: 1180, height: 820},
      deviceScaleFactor: 2,
      hasTouch: true,
      locale: 'da-DK',
      timezoneId: 'Europe/Copenhagen',
    });
    await context.addInitScript(
      ([url, secret]) => {
        if (location.origin !== new URL(url).origin || location.pathname.startsWith('/api/hassio_ingress/')) return;
        if (localStorage.getItem('hassTokens')) return;
        localStorage.setItem('hassTokens', JSON.stringify({
          hassUrl: url, clientId: `${url}/`, access_token: secret, token_type: 'Bearer',
          expires_in: 1800, expires: Date.now() + 365 * 864e5, refresh_token: '',
        }));
      },
      [BASE, token],
    );
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(redact(error.message, token)));

    if (args[0] === 'rollback') {
      await page.goto(`${BASE}/`, {waitUntil: 'domcontentloaded'});
      return await rollback(page, ha);
    }

    const startedAt = Date.now() / 1000;
    const frame = await openPodView(page);
    const addons = await ourAddons(page);
    const versions = addons.map(([name, a]) => `${name} ${a.version}`).join(', ');
    console.log(`Green-tjek ${new Date().toLocaleString('da-DK', {timeZone: 'Europe/Copenhagen'})} · ${versions}`);
    const before = await readLogs(page, ha, addons);
    const check = new Check(page, frame, out);
    await silentChecks(check);
    if (flag('--sound')) await soundChecks(check, ha);
    else check.record('lyd', 'A1 A2 H1 R1 R2', 'sprunget', 'kør med --sound kl. 08–18');
    await sleep(2000);
    logResults(check, before, await readLogs(page, ha, addons), startedAt);
    check.record('JavaScript-fejl', 'G1', pageErrors.length ? 'fejl' : 'ok', pageErrors.slice(0, 3).join('; '));

    const result = summary(check.results);
    fs.writeFileSync(path.join(out, 'rapport.json'), JSON.stringify({versions, results: check.results}, null, 2));
    console.log(`\n${result.line}. Rapport og skærmbilleder: ${out}`);
    if (result.green) {
      await rememberGreen(page, ha);
      console.log(`Versionerne er gemt som sidste grønne i ${LAST_GREEN}.`);
    } else console.log('Ved rød efter en installation: node scripts/green-check.mjs rollback');
    return result.green ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().then(
  code => process.exit(code),
  error => {
    console.error('Green-tjek kunne ikke køre:', redact(error?.message || error, SECRET));
    process.exit(2);
  },
);
