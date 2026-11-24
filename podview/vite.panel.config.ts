// The Home Assistant panel build: one ES module and its stylesheet in the integration
// (custom_components/podvoice/frontend/), served by HA itself (panel.py) under a digest of every file, plus the
// small loader HA loads first (podview-loader.js, src/panel/loader.ts). The icons, the images the screens name and
// the files the stylesheet references are copied next to it.
import {copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, {reactCompilerPreset} from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import type {Plugin} from 'vite';
import {panelLoader} from './build/panel-loader.mjs';
import {panelPurge} from './build/panel-purge.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = path.join(root, 'public');
const outDir = fileURLToPath(new URL('../custom_components/podvoice/frontend', import.meta.url));

const addonVersion = /^version: "(\d+\.\d+\.\d+)"$/m.exec(
  readFileSync(new URL('../podvoice/config.yaml', import.meta.url), 'utf8'),
)?.[1];
if (!addonVersion) throw Error('Missing version in podvoice/config.yaml');

function copy(relative: string) {
  const target = path.join(outDir, relative);
  mkdirSync(path.dirname(target), {recursive: true});
  copyFileSync(path.join(publicDir, relative), target);
}

// The icons the screens name (assets/icons/*.svg) and every public file the stylesheet links.
const panelAssets: Plugin = {
  name: 'podview-panel-assets',
  apply: 'build',
  writeBundle(_options, bundle) {
    for (const name of readdirSync(path.join(publicDir, 'assets/icons'))) {
      if (name.endsWith('.svg') || name === 'LICENSE' || name === 'PHOSPHOR-LICENSE') copy(`assets/icons/${name}`);
    }
    // Ro's photo (podview/src/panel/Rest.tsx) and the radio stations' logos (screens/Radio.tsx).
    copy('ambient.webp');
    // The pinned illustration an answer can carry (podvoice/gatekeeper/podview_presentation.py).
    copy('assets/bicycle-drivetrain-illustration.webp');
    for (const name of readdirSync(path.join(publicDir, 'assets'))) {
      if (/^radio-[a-z0-9-]+\.svg$/.test(name)) copy(`assets/${name}`);
    }
    for (const file of Object.values(bundle)) {
      if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;
      // Lib mode writes the stylesheet's public URLs as ../assets/; the stylesheet sits next to them.
      const target = path.join(outDir, file.fileName);
      const css = readFileSync(target, 'utf8').replaceAll('url(../assets/', 'url(./assets/');
      writeFileSync(target, css);
      for (const [, url] of css.matchAll(/url\(\s*['"]?\.\/(assets\/[^)'"?#\s]+)/g)) if (url) copy(url);
    }
  },
};

export default defineConfig({
  root,
  base: './',
  publicDir,
  define: {
    __PODVIEW_BUILD__: JSON.stringify(addonVersion),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [
    react(),
    babel({presets: [reactCompilerPreset()]}),
    tailwindcss(),
    panelPurge(),
    panelAssets,
    panelLoader({entry: path.join(root, 'src/entries/loader.ts'), outDir}),
  ],
  build: {
    outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    target: 'safari16',
    cssCodeSplit: false,
    minify: true,
    cssMinify: true,
    modulePreload: {polyfill: false},
    lib: {
      entry: path.join(root, 'src/entries/panel.ts'),
      formats: ['es'],
      fileName: () => 'podview-panel.js',
      cssFileName: 'podview-panel',
    },
    // Lib mode keeps an ES module's whitespace by default; the panel is an app, not a library.
    rolldownOptions: {output: {minify: true}},
  },
});
