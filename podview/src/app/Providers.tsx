// Every React root in PodView renders inside these providers: the shared query cache, React Aria's Danish
// locale and motion/react's reduced-motion rule (the system preference, as docs/MOTION.md §0).
import {QueryClientProvider} from '@tanstack/react-query';
import type {QueryClient} from '@tanstack/react-query';
import {MotionConfig} from 'motion/react';
import type {ReactNode} from 'react';
import {I18nProvider} from 'react-aria-components';
import {queryClient as appClient} from '../lib/query/client';

export function Providers({children, client = appClient}: {children: ReactNode; client?: QueryClient}) {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="da-DK">
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </I18nProvider>
    </QueryClientProvider>
  );
}
