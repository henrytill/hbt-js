// @ts-check
// Builds the browser outputs with esbuild: the library and the unit
// tests. Everything that runs under node - the library npm consumers
// import, and the CLI - is tsc's, as the prebuild script.
// Bundling the library for the browser also means a dependency that
// reaches for a Node builtin fails the build the day it is added
// rather than the day a browser front end is.
import * as fs from 'node:fs';

import * as esbuild from 'esbuild';

/** @type {esbuild.BuildOptions} */
const common = { bundle: true, sourcemap: true, logLevel: 'warning' };
// Not test/cli: the CLI's test spawns it, so it runs under node alone.
const tests = fs.globSync('test/unit/**/*.test.ts');
const browserEntry = [
	`import * as test from './test/browser/test.ts';`,
	'test.run(() => {',
	...tests.map((t) => `\trequire('./${t}');`),
	'});',
];

await Promise.all([
	esbuild.build({
		...common,
		entryPoints: ['src/index.ts'],
		platform: 'browser',
		format: 'esm',
		outfile: 'dist/browser/hbt.js',
	}),

	// The unit tests in one classic script, since Chrome refuses
	// module scripts from file:// URLs. Both node modules they import
	// resolve to the stand-ins in test/browser/ through
	// test/unit/tsconfig.json's paths, which esbuild reads as tsc does,
	// so the two cannot map them differently. browserEntry loads
	// the test files with require() rather than import, which esbuild
	// evaluates lazily at the call, so `test.run` can catch a throw
	// while they load and every test has registered before it runs
	// them.
	esbuild.build({
		...common,
		stdin: {
			contents: browserEntry.join('\n'),
			resolveDir: '.',
			sourcefile: 'tests.ts',
			loader: 'ts',
		},
		platform: 'browser',
		format: 'iife',
		outfile: 'dist/test/browser/tests.js',
	}),
]);

fs.copyFileSync('test/browser/index.html', 'dist/test/browser/index.html');
