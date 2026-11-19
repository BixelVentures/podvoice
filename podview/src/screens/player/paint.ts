// What each drawn player element shows, as the controller last set it. A controller writes `set(key, prop,
// value)` exactly where the pre-React views wrote the DOM; React draws the faces (a face only overrides the
// element's static markup for the props it names), and `settle()` then checks every prop written in this pass
// against the real element and corrects it. Other code still writes some of these elements directly (the shell
// enables Find musik, the controls painter disables the current queue row, the kit marks progress), so a write
// that repeats an unchanged face must reach the DOM again, exactly as the old compare-then-write did; a prop the
// pass did not write is left as it is. An identical pass writes nothing.
//
// Props: 'text' (textContent), 'hidden' and 'disabled' (properties), 'style.<name>' (an inline style property,
// `--custom` too) and any other name as an attribute (null removes it).

export type PaintValue = string | boolean | null;
export type Face = Readonly<Record<string, PaintValue>>;
export type Faces = Readonly<Record<string, Face | undefined>>;

const EMPTY: Face = Object.freeze({});

export class Paint {
  private faces: Record<string, Face> = {};
  private snapshot: Faces = Object.freeze({});
  private changed = false;
  private touched = new Map<string, Map<string, PaintValue>>();
  private readonly elements = new Map<string, Element>();
  private readonly refs = new Map<string, (node: Element | null) => void>();

  set(key: string, prop: string, value: PaintValue): void {
    const face = this.faces[key] ?? EMPTY;
    if (face[prop] !== value || !(prop in face)) {
      this.faces = {...this.faces, [key]: Object.freeze({...face, [prop]: value})};
      this.changed = true;
    }
    let props = this.touched.get(key);
    if (!props) this.touched.set(key, (props = new Map<string, PaintValue>()));
    props.set(prop, value);
  }

  get(key: string): Face {
    return this.faces[key] ?? EMPTY;
  }

  // Forget a face whose element is gone (a removed queue row), so a new element with the key starts clean.
  drop(key: string): void {
    if (!(key in this.faces)) return;
    this.faces = Object.fromEntries(Object.entries(this.faces).filter(([name]) => name !== key));
    this.changed = true;
    this.touched.delete(key);
  }

  // The faces as one immutable value for React: a new object only when a face changed.
  view(): Faces {
    if (this.changed) {
      this.snapshot = Object.freeze({...this.faces});
      this.changed = false;
    }
    return this.snapshot;
  }

  // A stable ref callback per key: the drawn element, also for elements without an id.
  ref(key: string): (node: Element | null) => void {
    let ref = this.refs.get(key);
    if (!ref) {
      ref = node => {
        if (node) this.elements.set(key, node);
        else this.elements.delete(key);
      };
      this.refs.set(key, ref);
    }
    return ref;
  }

  element(key: string): Element | undefined {
    return this.elements.get(key);
  }

  // After React drew: every prop written in this pass equals the real element (a direct write never sticks).
  settle(): void {
    const touched = this.touched;
    this.touched = new Map();
    for (const [key, props] of touched) {
      const node = this.elements.get(key);
      if (!node) continue;
      for (const [prop, value] of props) write(node, prop, value);
    }
  }
}

function write(node: Element, prop: string, value: PaintValue): void {
  const element = node as HTMLElement & {disabled?: boolean};
  if (prop === 'text') {
    const text = typeof value === 'string' ? value : '';
    if (node.textContent !== text) node.textContent = text;
  } else if (prop === 'hidden') {
    if (element.hidden !== (value === true)) element.hidden = value === true;
  } else if (prop === 'disabled') {
    if ('disabled' in element && element.disabled !== (value === true)) element.disabled = value === true;
  } else if (prop.startsWith('style.')) {
    const name = prop.slice(6);
    const text = typeof value === 'string' ? value : '';
    if (element.style.getPropertyValue(cssName(name)) !== text) element.style.setProperty(cssName(name), text);
  } else if (value === null) {
    if (node.hasAttribute(prop)) node.removeAttribute(prop);
  } else {
    const text = String(value);
    if (node.getAttribute(prop) !== text) node.setAttribute(prop, text);
  }
}

const cssName = (name: string) => (name.startsWith('--') ? name : name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`));

// A face as React props, overriding the static markup it is spread over. Text is read separately (text()).
export function props(face: Face | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!face) return out;
  let style: Record<string, string> | undefined;
  for (const [prop, value] of Object.entries(face)) {
    if (prop === 'text') continue;
    if (prop === 'hidden' || prop === 'disabled') out[prop] = value === true;
    else if (prop.startsWith('style.')) (style ??= {})[prop.slice(6)] = typeof value === 'string' ? value : '';
    else if (value === null) out[prop] = undefined;
    else out[prop] = String(value);
  }
  if (style) out.style = style;
  return out;
}

export function text(face: Face | undefined, fallback: string): string {
  const value = face?.text;
  return typeof value === 'string' ? value : fallback;
}
