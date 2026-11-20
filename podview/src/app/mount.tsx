// The legacy shell mounts each rewritten screen ONCE into its container. After that the component reads the
// query cache and the stores; the shell never renders it again and never writes inside the container.
import type {ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import {Providers} from './Providers';

const mounted = new WeakMap<Element, Root>();

export function mountScreen(container: Element, screen: ReactNode): Root {
  const existing = mounted.get(container);
  if (existing) return existing;
  container.replaceChildren();
  const root = createRoot(container);
  root.render(<Providers>{screen}</Providers>);
  mounted.set(container, root);
  return root;
}
