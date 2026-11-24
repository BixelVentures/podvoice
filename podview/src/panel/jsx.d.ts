// The custom tag name the stage stylesheet still styles (pv-widget-host, the shell's legacy hook). It is a plain
// element: React renders it, nothing defines it.
import type {DetailedHTMLProps, HTMLAttributes} from 'react';

type KitTag = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Partial<Record<`data-${string}`, string>>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pv-widget-host': KitTag;
    }
  }
}
