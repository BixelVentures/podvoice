import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

const SOURCE = /\.(?:ts|tsx)$/;

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    // Extensionless relative imports inside TypeScript sources.
    if (!specifier.startsWith('.') || SOURCE.test(specifier)) throw error;
    for (const extension of ['.ts', '.tsx']) {
      try {
        return await next(specifier + extension, context);
      } catch {}
    }
    throw error;
  }
}

export async function load(url, context, next) {
  if (!SOURCE.test(new URL(url).pathname)) return next(url, context);
  const source = await readFile(fileURLToPath(url), 'utf8');
  const {code} = await transform(source, {
    loader: url.endsWith('x') ? 'tsx' : 'ts',
    jsx: 'automatic',
    format: 'esm',
    sourcefile: fileURLToPath(url),
    sourcemap: 'inline',
    define: {__PODVIEW_BUILD__: 'undefined'},
  });
  return {format: 'module', source: code, shortCircuit: true};
}
