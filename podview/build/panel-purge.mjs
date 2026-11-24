// The panel's stylesheet carries the kit's stylesheet (src/styles/kit.css) whole, but renders only a few screens.
// After the bundle is built, this drops every style rule that can never match: each of its selectors names a class or
// id that appears nowhere in the panel's JavaScript (which holds every class and id any component or the stage can
// set). When in doubt a rule stays: selector parts inside :not()/:is()/:where()/:has() and attribute selectors are
// never used to drop it, and a class is taken as present when the script could build it from a prefix or a suffix.
// @font-face, @property, :root/html tokens and every rule without a class or id stay; @keyframes stay while
// anything still names them. At-rules left empty are removed.
import postcss from 'postcss';

const WORD = /[A-Za-z0-9_-]+/g;
// A class or id in a selector, CSS escapes included.
const NAME = /([.#])((?:\\[0-9a-fA-F]{1,6}\s?|\\[^\n0-9a-fA-F]|[A-Za-z0-9_\- -￿])+)/g;
const GROUPS = new Set(['media', 'supports', 'container', 'layer', 'starting-style']);

// Every word in the script, and the fragments a class could be built from (`pv-tile--${kind}`).
export function vocabulary(code) {
  const words = new Set(code.match(WORD));
  const prefixes = [];
  const suffixes = [];
  for (const word of words) {
    if (word.length < 3) continue;
    if (/[-_]$/.test(word)) prefixes.push(word);
    if (/^[-_]/.test(word)) suffixes.push(word);
  }
  return {code, words, prefixes, suffixes};
}

function unescape(name) {
  return name.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex, char) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char,
  );
}

function present(name, known) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return known.code.includes(name);
  return (
    known.words.has(name) ||
    known.prefixes.some(prefix => name.startsWith(prefix)) ||
    known.suffixes.some(suffix => name.endsWith(suffix))
  );
}

// The selector without the parts that never decide a drop: strings, attribute selectors and the arguments of
// functional pseudo-classes and pseudo-elements.
function positivePart(selector) {
  let out = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '\\') {
      if (!depth) out += selector.slice(i, i + 2);
      i++;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (!depth) out += char;
  }
  return out;
}

export function canMatch(selector, known) {
  for (const [, , name] of positivePart(selector).matchAll(NAME)) {
    if (!present(unescape(name), known)) return false;
  }
  return true;
}

function insideKeyframes(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true;
  }
  return false;
}

// Removes grouping at-rules left without rules, innermost first, until none is left.
function dropEmptyGroups(root) {
  for (let removed = true; removed; ) {
    removed = false;
    root.walkAtRules(rule => {
      if (GROUPS.has(rule.name.toLowerCase()) && rule.nodes && !rule.nodes.length) {
        rule.remove();
        removed = true;
      }
    });
  }
}

export function purgeCss(css, code) {
  const known = vocabulary(code);
  const root = postcss.parse(css);
  root.walkRules(rule => {
    if (!insideKeyframes(rule) && !rule.selectors.some(selector => canMatch(selector, known))) rule.remove();
  });
  dropEmptyGroups(root);
  const named = new Set(known.words);
  root.walkDecls(decl => {
    if (!insideKeyframes(decl)) for (const word of decl.value.match(WORD) ?? []) named.add(word);
  });
  root.walkAtRules(/keyframes$/i, rule => {
    if (!named.has(rule.params.trim().replace(/^["']|["']$/g, ''))) rule.remove();
  });
  return root.toString();
}

// Purges the emitted stylesheet against the emitted script (panel build only).
export function panelPurge() {
  return {
    name: 'podview-panel-purge',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.values(bundle);
      const code = files.map(file => (file.type === 'chunk' ? file.code : '')).join('\n');
      for (const file of files) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;
        const css = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
        file.source = purgeCss(css, code);
      }
    },
  };
}
