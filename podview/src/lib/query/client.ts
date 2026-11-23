// The one QueryClient. PodView's server data arrives by push (the SSE snapshot stream, the shell's home read) and
// is written into this cache; components subscribe with hooks. Nothing refetches by itself: a wall screen must
// not re-read on focus or retry a request on its own, and the last known data stays until replaced.
import {QueryClient, notifyManager} from '@tanstack/react-query';

// A pushed cache update reaches its subscribers at once (React batches the renders it causes). The default, a
// zero timeout, would make delivery depend on the page's timers and arrive after the frame that caused it.
notifyManager.setScheduler(callback => {
  callback();
});

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
      },
    },
  });
}

export const queryClient = createQueryClient();
