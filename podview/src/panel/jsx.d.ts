// The PodView host element the stage stylesheet styles (pv-widget-host …).
import type {DetailedHTMLProps, HTMLAttributes} from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pv-widget-host': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> &
        Partial<Record<`data-${string}`, string>>;
    }
  }
}
