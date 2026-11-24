// Vitest for PodView (podview/src/**/*.test.*) and the scripts' tests. The panel is built by vite.panel.config.ts.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, {reactCompilerPreset} from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

// The add-on version is the build id PodView reports in its diagnostics.
const addonVersion = /^version: "(\d+\.\d+\.\d+)"$/m.exec(
  readFileSync(new URL('../podvoice/config.yaml', import.meta.url), 'utf8'),
)?.[1];
if (!addonVersion) throw Error('Missing version in podvoice/config.yaml');

export default defineConfig({
  root,
  base: './',
  publicDir: 'public',
  define: {__PODVIEW_BUILD__: JSON.stringify(addonVersion)},
  plugins: [react(), babel({presets: [reactCompilerPreset()]}), tailwindcss()],
  test: {
    // PodView, and the Node tooling's own tests (scripts/*.test.mjs).
    include: ['src/**/*.test.{ts,tsx}', '../scripts/*.test.mjs'],
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
