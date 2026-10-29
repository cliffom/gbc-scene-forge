/** Exercise native fetch aborts after response headers, for JSON, downloads and HTTP errors. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ApiClient, HttpError } from '../frontend/legacy/api.mts';
import { activeApply } from '../frontend/legacy/decode.mts';

const exampleScene = {
  version: 1,
  connector: 'test',
  id: 'test',
  name: 'Test',
  profile: 'test',
  source_digest: 'revision',
  width: 1,
  height: 1,
  cells: [['floor']],
  references: [],
};

await test('deadlines cover response bodies and error-body parsing', async (t) => {
  let status = 200,
    headersSent = 0;
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.flushHeaders();
    response.write('{"id":');
    headersSent++;
    // Deliberately never finish this body; the client must abort it.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: string | URL | Request, init?: RequestInit) =>
    nativeFetch(
      typeof input === 'string' ? new URL(input, `http://127.0.0.1:${address.port}`) : input,
      init,
    ),
  );
  const client = new ApiClient();
  try {
    const timedOut = (error: unknown) =>
      error instanceof HttpError && /did not respond within/.test(error.message);
    await assert.rejects(
      client.json('apply-active', activeApply, undefined, { timeoutMs: 200 }),
      timedOut,
    );
    await assert.rejects(
      client.request('document', { scene: exampleScene }, { timeoutMs: 200 }),
      timedOut,
    );
    status = 503;
    await assert.rejects(
      client.json('apply-active', activeApply, undefined, { timeoutMs: 200 }),
      timedOut,
    );
    assert.equal(headersSent, 3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
