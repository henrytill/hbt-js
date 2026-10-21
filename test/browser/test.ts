// Stands in for `node:test` in the browser bundle (see
// scripts/build.mjs): just the `describe` and `it` the unit tests use,
// each test registered with the page's runner in page.ts.
import { register } from './page.js';

const suites: string[] = [];

export function describe(name: string, fn: () => void): void {
	suites.push(name);
	try {
		fn();
	} finally {
		suites.pop();
	}
}

export function it(name: string, fn: () => unknown): void {
	register({ suites: [...suites], name, fn });
}
