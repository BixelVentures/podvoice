// Login to the real PodView panel on HA Green for scripts/green-check.mjs.
// The token comes from $GREEN_HA_TOKEN or the macOS keychain (service "podvoice-green-check"); it is handed to
// the browser through HA's own localStorage entry and is never printed or written to disk.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

export const GREEN_BASE = (process.env.GREEN_HA_URL || 'http://homeassistant.lan:8123').replace(/\/$/, '');
export const GREEN_PANEL = (process.env.GREEN_PANEL || 'podview').replace(/^\/|\/$/g, '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function readGreenToken() {
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

export function greenLaunchOptions(headed = false) {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return {
    headless: !headed,
    ...(process.env.PODVIEW_TEST_CHROMIUM ? {executablePath: process.env.PODVIEW_TEST_CHROMIUM}
      : process.platform === 'darwin' && fs.existsSync(mac) ? {executablePath: mac} : {}),
  };
}

export async function greenBrowserContext(browser, token, viewport = {width: 1180, height: 820}) {
  const context = await browser.newContext({
    viewport,
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
    [GREEN_BASE, token],
  );
  return context;
}

// The PodView frame inside HA's custom panel: HA renders /podview as a same-origin iframe (embed_iframe) whose document
// holds the React shell (Shell.tsx, the element with data-link). `room` opens /podview/<area_id>, the way a wall
// tablet's kiosk URL fixes its room.
export async function openGreenPodView(page, {room = null} = {}) {
  const route = room ? `${GREEN_PANEL}/${encodeURIComponent(room)}` : GREEN_PANEL;
  await page.goto(`${GREEN_BASE}/${route}`, {waitUntil: 'domcontentloaded', timeout: 30000});
  for (let n = 0; n < 200; n++) {
    if (/\/auth\/authorize/.test(page.url()))
      throw new Error('HA viste loginsiden: tokenet blev ikke accepteret (se --help under Login)');
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (await frame.locator('[data-link]').count().catch(() => 0)) return frame;
    }
    await sleep(150);
  }
  throw new Error(`PodView-panelet blev ikke fundet på /${route}`);
}
