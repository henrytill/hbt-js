// Builds every output with esbuild; tsc only typechecks (`noEmit`).
// The library is also bundled for the browser, so a dependency that
// reaches for a Node builtin fails the build the day it is added
// rather than the day a browser front end is.
import { copyFileSync, globSync } from 'node:fs';

import * as esbuild from 'esbuild';

const common = { bundle: true, sourcemap: true, logLevel: 'warning' };
const tests = globSync('src/**/*.test.ts');

await Promise.all([
	esbuild.build({ ...common, entryPoints: ['src/cli.ts'], platform: 'node', format: 'esm', outfile: 'dist/cli.js' }),
	esbuild.build({ ...common, entryPoints: ['src/index.ts'], platform: 'browser', format: 'esm', outfile: 'dist/browser/hbt.js' }),

	// One bundle per test file, so `node --test` reports each file
	// and runs them under the real `node:test`.
	esbuild.build({ ...common, entryPoints: tests, outbase: 'src', platform: 'node', format: 'esm', outdir: 'dist/test/node' }),

	// The same tests in one classic script, since Chrome refuses
	// module scripts from file:// URLs. Both node modules they import
	// are swapped for the shims in test/browser/, and `run` goes last:
	// imports evaluate in order, so every test has registered by then.
	esbuild.build({
		...common,
		stdin: {
			contents: [...tests.map((t) => `import './${t}';`), `import { run } from './test/browser/test.ts';`, 'run();'].join('\n'),
			resolveDir: '.',
			sourcefile: 'tests.ts',
			loader: 'ts',
		},
		platform: 'browser',
		format: 'iife',
		alias: { 'node:test': './test/browser/test.ts', 'node:assert/strict': './test/browser/assert.ts' },
		outfile: 'dist/test/browser/tests.js',
	}),
]);

copyFileSync('test/browser/index.html', 'dist/test/browser/index.html');
