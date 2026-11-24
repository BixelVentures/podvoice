// Every React root in PodView renders inside these providers: the shared query cache, React Aria's Danish
// locale and motion/react's configuration (docs/MOTION.md §1): the system's reduced-motion preference and the default
// transition, the smooth spring, for any motion element that names none (layout animations among them). The same
// preference marks the document `data-pv-motion` for the stylesheet's reduced-motion rules (its one writer).
import {QueryClientProvider} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {MotionConfig, useReducedMotion} from 'motion/react';
import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {I18nProvider} from 'react-aria-components';
import {TRANSITION} from '../lib/motion/tokens';
import {queryClient as appClient} from '../lib/query/client';

function MotionMark() {
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    globalThis.document.documentElement.dataset.pvMotion = reduced ? 'reduced' : 'full';
  }, [reduced]);
  return null;
}

export function Providers({children, client = appClient}: {children: ReactNode; client?: QueryClient}) {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="da-DK">
        <MotionConfig reducedMotion="user" transition={TRANSITION.smooth}>
          <MotionMark />
          {children}
        </MotionConfig>
      </I18nProvider>
    </QueryClientProvider>
  );
}
