// The pre-React stylesheets, in cascade order. The Vite plugin below resolves them for the
// 1180×820 stage and inlines small icons, as the old esbuild/asset pipeline did. Screens that
// move to React bring their own styles; this list shrinks to nothing as the migration ends.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveStage} from './stage-css.mjs';

export const podviewRoot = fileURLToPath(new URL('../', import.meta.url));

export const stylesheetSources = [
  'ui/components.css',
  'widget-view.css',
  'ui/library/library.css',
  'frame-layout.css',
  'widget-redesign.css',
  'timer-notice.css',
  'live-music.css',
  'ui-kit.css',
];

const ICON = /^assets\/icons\/[a-z0-9-]+\.svg$/;
const INLINE_LIMIT = 4096;

// Rewrites relative url()s from a source stylesheet to the public directory (served at the
// page root) and inlines small icons as base64, exactly as the delivered podview.css did.
export function rebaseUrls(css, source, readAsset) {
  return css.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (all, quote, url) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return all;
    const rebased = path.posix.normalize(path.posix.join(path.posix.dirname(source), url));
    if (ICON.test(rebased)) {
      const asset = readAsset(rebased);
      if (asset && asset.length <= INLINE_LIMIT) {
        return `url("data:image/svg+xml;base64,${Buffer.from(asset).toString('base64')}")`;
      }
    }
    return `url(${quote}/${rebased}${quote})`;
  });
}

// One stylesheet as the wall iPad receives it.
export function stageStylesheet(css, source, readAsset = publicAsset) {
  if (/@import\b/i.test(css)) {
    throw Error(`Unexpected CSS import in ${source}; add its owner to the ordered source list.`);
  }
  return rebaseUrls(resolveStage(css), source, readAsset);
}

// All legacy stylesheets concatenated in cascade order (used by tests that inspect the result).
export function composeStyles(sources, readSource, readAsset = publicAsset) {
  return sources.map(source => stageStylesheet(readSource(source), source, readAsset)).join('\n');
}

export function publicAsset(relative) {
  try {
    return readFileSync(path.join(podviewRoot, 'public', relative));
  } catch {
    return null;
  }
}

// Vite plugin for the pre-React stylesheets (everything outside src/). Their url()s point at
// the public directory; imported with `?stage` they are also resolved for the wall stage.
export function stageStylesPlugin() {
  return {
    name: 'podview-stage-styles',
    enforce: 'pre',
    transform(code, id) {
      const [file, query] = id.split('?');
      if (!file.endsWith('.css') || !file.startsWith(podviewRoot)) return null;
      const source = path.relative(podviewRoot, file).split(path.sep).join('/');
      if (source.startsWith('src/') || source.startsWith('..')) return null;
      const css = query === 'stage' ? stageStylesheet(code, source) : rebaseUrls(code, source, publicAsset);
      return {code: css, map: null};
    },
  };
}

// The wall page's pre-React stylesheet as one string, as the browser receives it.
export function deliveredStylesheet() {
  return composeStyles(stylesheetSources, source => readFileSync(path.join(podviewRoot, source), 'utf8'));
}
