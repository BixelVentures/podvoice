import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, {reactCompilerPreset} from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';
import {stageStylesPlugin} from './build/legacy-styles.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const ENTRY_NAMES: Record<string, string> = {
  index: 'podview.bundle.js',
  library: 'library.bundle.js',
  setup: 'setup.js',
};

// Pages reference their files as plain relative names (`podview.bundle.js`), as before.
const plainRelativeUrls = {
  name: 'podview-plain-relative-urls',
  transformIndexHtml: {
    order: 'post' as const,
    handler: (html: string) => html.replace(/(\s(?:src|href)=")\.\//g, '$1'),
  },
};
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// The add-on version is the build id PodView reports in its diagnostics.
const addonVersion = /^version: "(\d+\.\d+\.\d+)"$/m.exec(
  readFileSync(new URL('../podvoice/config.yaml', import.meta.url), 'utf8'),
)?.[1];
if (!addonVersion) throw Error('Missing version in podvoice/config.yaml');

export default defineConfig({
  root,
  // Served under Home Assistant ingress at an unknown prefix: every URL stays relative.
  base: './',
  publicDir: 'public',
  define: {__PODVIEW_BUILD__: JSON.stringify(addonVersion)},
  plugins: [
    stageStylesPlugin(),
    react(),
    babel({presets: [reactCompilerPreset()]}),
    tailwindcss(),
    plainRelativeUrls,
  ],
  build: {
    // The add-on image has no Node; the built PodView is committed where the server serves it.
    outDir: fileURLToPath(new URL('../podvoice/gatekeeper/static/podview', import.meta.url)),
    emptyOutDir: true,
    target: 'safari16',
    assetsDir: 'build',
    modulePreload: {polyfill: false},
    rolldownOptions: {
      input: {
        index: page('index.html'),
        setup: page('setup.html'),
        library: page('library.html'),
      },
      output: {
        // Stable names for the two page entries: journeys and diagnostics fingerprint what was
        // served by name, and the server sends `no-cache`, so every load revalidates.
        entryFileNames: chunk => ENTRY_NAMES[chunk.name] ?? 'build/[name]-[hash].js',
        chunkFileNames: 'build/[name]-[hash].js',
        assetFileNames: asset => (asset.names[0] === 'index.css' ? 'podview.css' : 'build/[name]-[hash][extname]'),
      },
    },
  },
  server: {host: '127.0.0.1', port: 4173},
  test: {
    include: ['src/**/*.test.{ts,tsx,js}'],
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
