/** Exercise the supported transport's native aborts after response headers. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ProjectApi } from '../frontend/project/project-api.mts';

await test('deadlines cover JSON, download and HTTP error response bodies', async () => {
  let status = 200,
    headersSent = 0;
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.flushHeaders();
    response.write('{"id":');
    headersSent++;
    // Deliberately never finish this body; the transport deadline must abort it.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const client = new ProjectApi(`http://127.0.0.1:${address.port}`);
  const aborted = (error: unknown) =>
    error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name);
  try {
    await assert.rejects(
      (async () => {
        await (await client.request('scene/room', undefined, 200)).json();
      })(),
      aborted,
    );
    await assert.rejects(
      (async () => (await client.request('export', { scene: 'room' }, 200)).blob())(),
      aborted,
    );
    status = 503;
    await assert.rejects(client.request('catalog', undefined, 200), aborted);
    assert.equal(headersSent, 3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
