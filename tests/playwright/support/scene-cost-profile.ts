/** Test-only wrappers around domain boundaries; never bundled into released assets. */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, relative } from 'node:path';

declare global {
  interface Window {
    sceneCosts: Record<string, number[]>;
    profileLongTasks: { startTime: number; duration: number }[];
  }
}

export async function sceneCostBundle(baseline: boolean) {
  const helper = `function measured<T>(name:string, work:()=>T):T {
    const start=performance.now(); try { return work(); } finally {
      (globalThis.sceneCosts[name]??=[]).push(performance.now()-start);
    }
  }\n`;
  const wrappers: Record<string, [string, string, string, string][]> = {
    'project-editor.mts': [
      ['function update(checkpoint = true)', 'controls', 'checkpoint', 'checkpoint'],
    ],
    'editor-panels.mts': [['function renderObjectValidation()', 'objectValidation', '', '']],
    'editor-rendering.mts': [
      ['function draw(refreshUI = true)', 'drawIncludingControls', 'refreshUI', 'refreshUI'],
      [
        'function repaint(size: number, zoom: number)',
        'paint',
        'size: number, zoom: number',
        'size, zoom',
      ],
    ],
    'editor-recovery.mts': [
      ['function checkpoint(dirty?: boolean)', 'checkpointPreparation', 'dirty?: boolean', 'dirty'],
    ],
    'editor-state.mts': [
      ['snapshot()', 'dirtySnapshot', '', ''],
      ['serialize()', 'sceneSerialization', '', ''],
    ],
    'drafts.mts': [
      [
        'observe(value: Record<string, unknown> | null)',
        'checkpointComparison',
        'value: Record<string, unknown> | null',
        'value',
      ],
    ],
  };
  const result = await build({
    entryPoints: ['frontend/project.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    define: { __FORGE_BUILD_LABEL__: '"cost-profile"' },
    plugins: [
      {
        name: 'scene-costs',
        setup(builder) {
          builder.onLoad({ filter: /\.mts$/ }, async (args) => {
            const path = relative(process.cwd(), args.path);
            if (!path.startsWith('frontend/')) {
              return;
            }
            const name = basename(args.path);
            let source = baseline
              ? execFileSync('git', ['show', `a268f271102e97fd9b31448b8721f0b07ddfc5ec:${path}`], {
                  encoding: 'utf8',
                })
              : await readFile(args.path, 'utf8');
            for (const [declaration, metric, parameters, values] of wrappers[name] ?? []) {
              const isFunction = declaration.startsWith('function ');
              const method = declaration.replace('function ', '').split('(')[0];
              const replacement = isFunction
                ? `${declaration} {return measured('${metric}',()=>${method}Measured(${values}));} function ${method}Measured(${parameters}) {`
                : `${declaration} {return measured('${metric}',()=>this.${method}Measured(${values}));} private ${method}Measured(${parameters}) {`;
              const needle = `${declaration} {`;
              if (!source.includes(needle)) {
                throw Error(`Missing profiling boundary: ${name} ${declaration}`);
              }
              source = source.replace(needle, replacement);
            }
            return { contents: helper + source, loader: 'ts' };
          });
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}
