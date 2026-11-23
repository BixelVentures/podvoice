// The shell publishes the connection on every render; an unchanged value must not redraw the React screens.
import assert from 'node:assert/strict';
import {act, render} from '@testing-library/react';
import {test, vi} from 'vitest';
import {useNow} from '../hooks/clock';
import {createQueryClient} from './client';
import {DEMO_CONNECTION, ingestConnection} from './live';

test('an unchanged connection does not re-read the clock; a changed one does', () => {
  vi.useFakeTimers({now: 1_000_000});
  try {
    const client = createQueryClient();
    let renders = 0;
    function Clocked() {
      renders++;
      return <span>{useNow()}</span>;
    }
    render(<Clocked />);
    const publish = (connection: typeof DEMO_CONNECTION) => {
      act(() => {
        ingestConnection(connection, client);
      });
    };
    publish({...DEMO_CONNECTION});
    const settled = renders;
    for (let n = 0; n < 5; n++) {
      vi.advanceTimersByTime(7);
      publish({...DEMO_CONNECTION});
    }
    assert.equal(renders, settled, 'equal connections, published on every shell render, leave the screens alone');
    vi.advanceTimersByTime(7);
    publish({...DEMO_CONNECTION, status: 'connecting', connected: false});
    assert.ok(renders > settled, 'a new connection is judged by a fresh clock');
  } finally {
    vi.useRealTimers();
  }
});
