// Fallbacks for wall screens on old Android WebView (Chrome 107, e.g. Frameo frames).
// Chrome < 111 drops every declaration that uses color-mix() and Chrome < 108 drops dvh/svh/lvh.
// Each such declaration gets a static fallback in front of it, so newer browsers keep the
// original value and old ones keep a close equivalent instead of nothing.
// Custom properties cannot fall back by declaration order (the last one always wins), so the
// fallback goes in the rule and the original moves to an @supports copy right after it.

const MIX_SUPPORT = 'color:color-mix(in srgb,red,red)';
const DVH_SUPPORT = 'height:1dvh';
const GROUPING_AT_RULES = /^@(media|supports|container|layer|document|starting-style)\b/i;
const VIEWPORT_UNIT = /(\d|\.)(?:d|s|l)vh\b/g;

// Split at top-level occurrences of `separator`, ignoring parentheses and strings.
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// Index of the parenthesis that closes the one at `open`.
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function parseHex(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

function formatColor([r, g, b, a]) {
  const c = (v) => Math.round(Math.min(255, Math.max(0, v)));
  const alpha = Math.round(a * 1000) / 1000;
  return alpha >= 1 ? `rgb(${c(r)},${c(g)},${c(b)})` : `rgba(${c(r)},${c(g)},${c(b)},${alpha})`;
}

// Static resolver for the :root design tokens. currentColor resolves to the ink colour,
// which is what most PodView text and icons use; it only affects the old-WebView fallback.
export function createResolver(tokens) {
  const resolveVars = (value, seen = new Set()) =>
    value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\))*[^()]*))?\)/g, (all, name, fallback) => {
      if (seen.has(name)) return all;
      if (tokens.has(name)) return resolveVars(tokens.get(name), new Set([...seen, name]));
      return fallback === undefined ? all : resolveVars(fallback.trim(), seen);
    });

  const color = (raw) => {
    const value = resolveVars(raw.trim()).trim();
    if (/^transparent$/i.test(value)) return [0, 0, 0, 0];
    if (/^currentcolor$/i.test(value)) return tokens.has('--pv-ink') ? color('var(--pv-ink)') : null;
    if (/^#[0-9a-f]+$/i.test(value)) return parseHex(value);
    if (/^color-mix\(/i.test(value)) return mix(value);
    const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (rgb) {
      const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : +rgb[4];
      return [+rgb[1], +rgb[2], +rgb[3], alpha];
    }
    return null;
  };

  // color-mix(in srgb, A p1, B p2): premultiplied sRGB interpolation, as in CSS Color 5.
  const mix = (expression) => {
    const inner = expression.slice(expression.indexOf('(') + 1, closingParen(expression, expression.indexOf('(')));
    const [space, first, second] = splitTopLevel(inner, ',').map((part) => part.trim());
    if (!/^in\s+srgb$/i.test(space) || !first || !second) return null;
    const stop = (part) => {
      const match = resolveVars(part).trim().match(/^(.*?)(?:\s+([\d.]+)%)?$/s);
      return { color: color(match[1]), percent: match[2] === undefined ? null : +match[2] };
    };
    const a = stop(first);
    const b = stop(second);
    if (!a.color || !b.color) return null;
    let p1 = a.percent;
    let p2 = b.percent;
    if (p1 === null && p2 === null) p1 = p2 = 50;
    else if (p1 === null) p1 = 100 - p2;
    else if (p2 === null) p2 = 100 - p1;
    const total = p1 + p2;
    if (total <= 0) return null;
    const w1 = p1 / total;
    const w2 = p2 / total;
    const alpha = a.color[3] * w1 + b.color[3] * w2;
    const channel = (i) => (alpha === 0 ? 0 : (a.color[i] * a.color[3] * w1 + b.color[i] * b.color[3] * w2) / alpha);
    return [channel(0), channel(1), channel(2), alpha * Math.min(1, total / 100)];
  };

  // Replace every color-mix() in a value; null when any of them cannot be resolved statically.
  const lowerValue = (value) => {
    let out = '';
    let rest = value;
    for (;;) {
      const at = rest.search(/color-mix\(/i);
      if (at < 0) break;
      const end = closingParen(rest, at + 'color-mix'.length);
      if (end < 0) return null;
      const resolved = mix(rest.slice(at, end + 1));
      if (!resolved) return null;
      out += rest.slice(0, at) + formatColor(resolved);
      rest = rest.slice(end + 1);
    }
    return (out + rest).replace(VIEWPORT_UNIT, '$1vh');
  };

  return { color, lowerValue };
}

// Design tokens for the static fallbacks. :root wins, last definition first (as in the cascade).
// A token only set on components (e.g. --pv-tint-ink on .pv-kit) uses its first, base definition.
export function collectTokens(css) {
  const root = new Map();
  const base = new Map();
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of uncommented.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const isRoot = match[1].split(',').some((selector) => selector.trim() === ':root');
    for (const declaration of splitTopLevel(match[2], ';')) {
      const colon = declaration.indexOf(':');
      const name = declaration.slice(0, colon).trim();
      if (!name.startsWith('--')) continue;
      const value = declaration.slice(colon + 1).trim();
      if (isRoot) root.set(name, value);
      else if (!base.has(name)) base.set(name, value);
    }
  }
  return new Map([...base, ...root]);
}

function lowerDeclarations(body, resolver) {
  const supportsCopies = [];
  const declarations = splitTopLevel(body, ';').map((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon < 0) return declaration;
    const value = declaration.slice(colon + 1);
    const usesMix = /color-mix\(/i.test(value);
    const usesViewport = VIEWPORT_UNIT.test(value);
    VIEWPORT_UNIT.lastIndex = 0;
    if (!usesMix && !usesViewport) return declaration;
    const fallback = resolver.lowerValue(value);
    if (fallback === null || fallback === value) return declaration;
    const property = declaration.slice(0, colon);
    if (property.trim().startsWith('--')) {
      const conditions = [usesMix && MIX_SUPPORT, usesViewport && DVH_SUPPORT].filter(Boolean);
      supportsCopies.push({ conditions, declaration: declaration.trim() });
      return `${property}:${fallback}`;
    }
    return `${property}:${fallback};${declaration}`;
  });
  return { body: declarations.join(';'), supportsCopies };
}

// Walk the stylesheet block by block; style rules get their declarations lowered.
function lowerBlocks(css, resolver, inKeyframes) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    const open = css.indexOf('{', i);
    const semicolon = css.indexOf(';', i);
    if (open < 0) {
      out += css.slice(i);
      break;
    }
    if (semicolon >= 0 && semicolon < open && css.slice(i, semicolon).trim().startsWith('@')) {
      out += css.slice(i, semicolon + 1);
      i = semicolon + 1;
      continue;
    }
    let depth = 0;
    let close = open;
    for (; close < css.length; close++) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}' && --depth === 0) break;
    }
    const prelude = css.slice(i, open);
    const body = css.slice(open + 1, close);
    const name = prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (GROUPING_AT_RULES.test(name)) {
      out += `${prelude}{${lowerBlocks(body, resolver, false)}}`;
    } else if (/^@(-webkit-)?keyframes\b/i.test(name)) {
      out += `${prelude}{${lowerBlocks(body, resolver, true)}}`;
    } else if (name.startsWith('@')) {
      out += `${prelude}{${body}}`;
    } else {
      const lowered = lowerDeclarations(body, resolver);
      out += `${prelude}{${lowered.body}}`;
      if (!inKeyframes) {
        for (const copy of lowered.supportsCopies) {
          out += `@supports (${copy.conditions.join(') and (')}){${name}{${copy.declaration}}}`;
        }
      }
    }
    i = close + 1;
  }
  return out;
}

export function addLegacyWebViewFallbacks(css) {
  const resolver = createResolver(collectTokens(css));
  return lowerBlocks(css, resolver, false);
}
