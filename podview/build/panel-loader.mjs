// Builds the panel's loader (src/entries/loader.ts) into podview-loader.js next to the bundle: one small ES module
// with no imports, which HA loads as the panel's module_url (custom_components/podvoice/panel.py).
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {buildSync} from 'esbuild';

export function panelLoader({entry, outDir}) {
  return {
    name: 'podview-panel-loader',
    apply: 'build',
    writeBundle() {
      const [output] = buildSync({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        target: 'safari16',
        minify: true,
        legalComments: 'none',
        write: false,
      }).outputFiles;
      writeFileSync(path.join(outDir, 'podview-loader.js'), output.text);
    },
  };
}
