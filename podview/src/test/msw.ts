// MSW: the PodVoice API for component and data tests. Tests add handlers for what they exercise
// (server.use(...)); a request nobody handles fails the test.
import {setupServer} from 'msw/node';
import {afterAll, afterEach, beforeAll} from 'vitest';

// The live page's URL under HA ingress, on the test document's own origin (the API is same-origin, so a request
// carries no CORS preflight); the API is its sibling /view/api/.
const ORIGIN = globalThis.location.origin;
export const PAGE_URL = `${ORIGIN}/api/hassio_ingress/token/view/index.html`;
export const API = `${ORIGIN}/api/hassio_ingress/token/view/api`;

export const server = setupServer();

// Call once at the top of a test file that talks to the API. (Not global: MSW owns fetch while it listens, and
// pre-React tests still replace fetch themselves.)
export function listenToApi() {
  beforeAll(() => {
    server.listen({onUnhandledFrame: 'error'});
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });
}
