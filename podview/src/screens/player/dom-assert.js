// node:assert/strict for the player's real-DOM suites. A comparison involving an object is decided as node:assert
// decides it (Object.is, isDeepStrictEqual), but fails with a plain AssertionError that names a DOM node by its tag,
// id and classes: node:assert's own AssertionError inspects happy-dom nodes in full, which exhausts the worker's memory
// (Vitest then reports only a killed worker).
import strict from 'node:assert/strict';
import {inspect, isDeepStrictEqual} from 'node:util';

const label = node => node.nodeType === 1
  ? `<${node.localName}${node.id ? `#${node.id}` : ''}${[...node.classList].map(name => `.${name}`).join('')}>`
  : `#${node.nodeName}(${JSON.stringify(node.nodeValue)})`;
Object.defineProperty(Node.prototype, inspect.custom, {configurable: true, value() { return label(this); }});
const show = value => inspect(value, {depth: 3, breakLength: Infinity});
const object = value => typeof value === 'object' && value !== null;
const described = (compare, same, wanted) => (actual, expected, message) => {
  if (!object(actual) && !object(expected)) return compare(actual, expected, message);
  if (same(actual, expected) === wanted) return;
  const error = new Error(message ?? `expected ${wanted ? '' : 'not '}${show(expected)}, got ${show(actual)}`);
  throw Object.assign(error, {name: 'AssertionError', actual: show(actual), expected: show(expected)});
};

const assert = {
  ...strict,
  equal: described(strict.equal, Object.is, true),
  strictEqual: described(strict.strictEqual, Object.is, true),
  notEqual: described(strict.notEqual, Object.is, false),
  deepEqual: described(strict.deepEqual, isDeepStrictEqual, true),
};
export default assert;
