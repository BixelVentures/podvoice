// The custom tag names the stage stylesheet styles (pv-widget-host, the answer card and its kit parts). They are
// plain elements: React renders them, nothing defines them.
import type {DetailedHTMLProps, HTMLAttributes} from 'react';

type KitTag = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Partial<Record<`data-${string}`, string>>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pv-widget-host': KitTag;
      'pv-answer': KitTag;
      'pv-choice-list': KitTag;
      'pv-checklist': KitTag;
      'pv-comparison-table': KitTag;
      'pv-data-chart': KitTag;
      'pv-step-guide': KitTag;
    }
  }
}
