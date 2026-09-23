// Stands in for `node:test` in the browser bundle (see build.mjs):
// just the `describe` and `it` the unit tests use, and a runner that
// writes the outcome into the page for `chromium --dump-dom` to read.

declare const document: { getElementById(id: string): { textContent: string | null } | null };

type Test = { readonly name: string; readonly fn: () => unknown };

const tests: Test[] = [];
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
	tests.push({ name: [...suites, name].join(' > '), fn });
}

export async function run(): Promise<void> {
	const lines: string[] = [];
	let failed = 0;
	for (const { name, fn } of tests) {
		try {
			await fn();
			lines.push(`ok - ${name}`);
		} catch (e) {
			failed += 1;
			lines.push(`not ok - ${name}`, `  ${String(e)}`);
		}
	}
	// The check greps for PASS, so a bundle that throws before
	// reaching here leaves the page saying RUNNING and fails.
	lines.push(failed === 0 ? `PASS ${tests.length}` : `FAIL ${failed} of ${tests.length}`);
	const result = document.getElementById('result');
	if (result !== null) result.textContent = lines.join('\n');
}
