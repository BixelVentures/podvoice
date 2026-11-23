// Every DOM write under a root, as names (`<tag#id.class>.textContent`, `.data.<key>`, `.style.<prop>`, …): an
// unchanged render must record none. Shared by the component tests (was in the timer fixture).
const label = node => {
  if (node?.nodeType !== 1) return '?';
  return `${node.localName}${node.id ? `#${node.id}` : ''}${node.classList[0] ? `.${node.classList[0]}` : ''}`;
};
const styles = text =>
  new Map(
    String(text || '')
      .split(';')
      .map(rule => rule.split(':'))
      .filter(pair => pair.length > 1)
      .map(([key, ...value]) => [key.trim(), value.join(':').trim()]),
  );
const dataKey = name => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export function recordWrites(root = document.body) {
  const rows = [];
  const observer = new MutationObserver(() => {});
  const options = {subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true};
  observer.observe(root, options);
  const collect = () => {
    const records = observer.takeRecords();
    const texts = new Set();
    const text = node => {
      if (texts.has(node)) return;
      texts.add(node);
      rows.push(`${label(node)}.textContent`);
    };
    records.forEach((record, index) => {
      const target = record.target;
      if (record.type === 'characterData') return text(target.parentNode);
      if (record.type === 'childList') {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.every(node => node.nodeType === 3)) text(target);
        else rows.push(`${label(target)}.insert`);
        return;
      }
      const name = record.attributeName;
      if (name === 'style') {
        const later = records.slice(index + 1).find(next => next.target === target && next.attributeName === 'style');
        const before = styles(record.oldValue);
        const after = styles(later ? later.oldValue : target.getAttribute('style'));
        const keys = [...new Set([...before.keys(), ...after.keys()])];
        const changed = keys.filter(key => before.get(key) !== after.get(key));
        if (!changed.length) rows.push(`${label(target)}.style`);
        for (const key of changed) rows.push(`${label(target)}.style.${key}`);
        return;
      }
      if (name.startsWith('data-')) rows.push(`${label(target)}.data.${dataKey(name)}`);
      else if (name === 'hidden' || name === 'disabled') rows.push(`${label(target)}.${name}`);
      else rows.push(`${label(target)}.attr.${name}`);
    });
  };
  return new Proxy(rows, {
    get(target, key, receiver) {
      collect();
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      collect();
      return Reflect.set(target, key, value, receiver);
    },
  });
}
