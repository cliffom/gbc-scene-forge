/** Frozen pre-optimization app rendering for pixel and observational comparisons. */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
export async function referenceRenderer() {
  const result = await build({
    entryPoints: ['frontend/project.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    define: { __FORGE_BUILD_LABEL__: '"reference"' },
    plugins: [
      {
        name: 'reference-renderer',
        setup(builder) {
          builder.onLoad({ filter: /editor-(rendering|viewport)\.mts$/ }, (args) => ({
            contents: readFileSync(
              `tests/fixtures/rendering-baseline/${basename(args.path, '.mts')}.txt`,
              'utf8',
            ),
            loader: 'ts',
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}
