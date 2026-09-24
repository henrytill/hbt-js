// Stands in for `node:test` in the browser bundle (see build.mjs):
// just the `describe` and `it` the unit tests use, and a runner that
// writes the outcome into the page twice - as lines in <pre id="result">
// for a person, and as JSON in <script id="report"> for run.mjs, which
// reads it back from `chromium --dump-dom`.

// Declared by hand rather than through lib "dom", which would let the
// library reach for browser globals too.
declare const document: { getElementById(id: string): { textContent: string | null } | null };
declare const navigator: { userAgent: string };

type Test = { readonly suites: readonly string[]; readonly name: string; readonly fn: () => unknown };
type Result = { readonly suites: readonly string[]; readonly name: string; readonly ok: boolean; readonly error?: string };
type Report = { readonly userAgent: string; readonly tests: readonly Result[]; readonly loadError?: string };

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
	tests.push({ suites: [...suites], name, fn });
}

// `load` evaluates the test files (see build.mjs), inside the try so
// that a throw while loading - a test file's describe, or a library
// module's top level - is reported with its message. Left to reach
// the page as an uncaught error, Chrome would mute it to "Script
// error." for a script from a file:// URL.
export async function run(load: () => void): Promise<void> {
	try {
		load();
	} catch (e) {
		write({ userAgent: navigator.userAgent, tests: [], loadError: String(e) });
		return;
	}
	const results: Result[] = [];
	for (const { suites, name, fn } of tests) {
		try {
			await fn();
			results.push({ suites, name, ok: true });
		} catch (e) {
			results.push({ suites, name, ok: false, error: String(e) });
		}
	}
	write({ userAgent: navigator.userAgent, tests: results });
}

function write(report: Report): void {
	const lines: string[] = [];
	for (const { suites, name, ok, error } of report.tests) {
		lines.push(`${ok ? 'ok' : 'not ok'} - ${[...suites, name].join(' > ')}`);
		if (error !== undefined) lines.push(`  ${error}`);
	}
	const failed = report.tests.filter((t) => !t.ok).length;
	const summary = report.loadError !== undefined ?
		`ERROR ${report.loadError}` :
		failed === 0 ?
		`PASS ${report.tests.length}` :
		`FAIL ${failed} of ${report.tests.length}`;
	lines.push(summary);
	const result = document.getElementById('result');
	if (result !== null) result.textContent = lines.join('\n');

	// A script's text is serialized verbatim, not entity-escaped, so
	// run.mjs needs no decoding; escaping every `<` keeps a `</script>`
	// in a test name or message from closing the element early.
	const json = document.getElementById('report');
	if (json !== null) json.textContent = toJson(report).replaceAll('<', '\\u003c');
}

// JSON.stringify(report, null, '\t'), except that each test stays on
// one line, so the report reads like the page's in DevTools' Elements
// tab. Every value still goes through JSON.stringify.
function toJson(report: Report): string {
	const tests = report.tests.map((t) => `\t\t${JSON.stringify(t)}`);
	const fields = [
		`\t"userAgent": ${JSON.stringify(report.userAgent)}`,
		tests.length === 0 ? '\t"tests": []' : `\t"tests": [\n${tests.join(',\n')}\n\t]`,
	];
	if (report.loadError !== undefined) fields.push(`\t"loadError": ${JSON.stringify(report.loadError)}`);
	return `{\n${fields.join(',\n')}\n}`;
}
