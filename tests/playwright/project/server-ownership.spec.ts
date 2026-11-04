/** Per-test activity logs must not share the checkout, even when ports are reused. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '../support/browser-fixtures.ts';

for (const fixture of [false, true]) {
  const name = fixture ? 'fixture' : 'launcher';
  test(`server activity logs belong to their workspace: ${name}`, async ({ page, workspace }) => {
    // Starting directly in folder must retain an empty project-creation directory.
    const url = new URL(`ownership-${name}`, await workspace.start(workspace.folder, fixture));
    await page.goto(url.href);
    const log = await readFile(
      join(workspace.folder, '..', '.forge-logs', `server-${url.port}.log`),
      'utf8',
    );
    expect(log).toContain(`GET /ownership-${name} HTTP/1.1`);
    expect(log).not.toContain(`GET /ownership-${fixture ? 'launcher' : 'fixture'} HTTP/1.1`);
    if (fixture) {
      expect(
        (await readFile(join(workspace.folder, '..', 'input', 'terrain.atlas.json'))).length,
      ).toBeGreaterThan(0);
    }
  });
}
