// Every React root in PodView renders inside these providers: the shared query cache, React Aria's Danish
// locale and motion/react's reduced-motion rule (the system preference, as docs/MOTION.md §0). The same preference marks
// the document `data-pv-motion` for the stylesheet's reduced-motion rules (its one writer).
import {QueryClientProvider} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {MotionConfig, useReducedMotion} from 'motion/react';
import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {I18nProvider} from 'react-aria-components';
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
        <MotionConfig reducedMotion="user">
          <MotionMark />
          {children}
        </MotionConfig>
      </I18nProvider>
    </QueryClientProvider>
  );
}
