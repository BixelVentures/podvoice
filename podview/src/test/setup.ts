import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';
import {connectApi} from '../lib/api/client';
import {queryClient} from '../lib/query/client';
import {connectShell, useShell} from '../lib/store/shell';

afterEach(() => {
  cleanup();
  // Every test starts from an empty cache and the default stores.
  queryClient.clear();
  connectApi(null);
  connectShell({dispatch: () => undefined, focusHeading: () => undefined, loadHome: () => undefined,
    showFeedback: () => undefined});
  useShell.setState({focus: 'now', motion: null});
});

// React's act() is how tests flush renders the cache causes.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
