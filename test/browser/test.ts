// Stands in for `node:test` in the browser bundle (see build.mjs):
// just the `describe` and `it` the unit tests use, and a runner that
// writes the outcome into the page twice - as lines in <pre id="result">
// for a person, and as JSON in <script id="report"> for run.mjs, which
// reads it back from `chromium --dump-dom`.

// Declared by hand rather than through lib "dom", which would let the
// library reach for browser globals too.
type Element = { className: string; textContent: string | null; replaceChildren(...nodes: (Element | string)[]): void };
declare const document: {
	title: string;
	getElementById(id: string): Element | null;
	createElement(tag: string): Element;
};
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

export type Line = { readonly className: string; readonly text: string };

// The report as text - a line per test and error, and a summary - for
// both the page and run.mjs, which imports this from tsc's build of
// this file so that the two cannot drift apart. className is what the
// page's stylesheet colours each line by.
export function format(report: Report): { readonly lines: readonly Line[]; readonly summary: Line; readonly passed: boolean } {
	const lines: Line[] = [];
	for (const { suites, name, ok, error } of report.tests) {
		lines.push({ className: ok ? 'pass' : 'fail', text: `${ok ? 'ok' : 'not ok'} - ${[...suites, name].join(' > ')}` });
		if (error !== undefined) lines.push({ className: 'error', text: `  ${error}` });
	}
	const failed = report.tests.filter((t) => !t.ok).length;
	const passed = report.loadError === undefined && failed === 0;
	const text = report.loadError !== undefined ?
		`ERROR ${report.loadError}` :
		passed ?
		`PASS ${report.tests.length}` :
		`FAIL ${failed} of ${report.tests.length}`;
	return { lines, summary: { className: `summary ${passed ? 'pass' : 'fail'}`, text }, passed };
}

function span({ className, text }: Line): Element {
	const span = document.createElement('span');
	span.className = className;
	span.textContent = `${text}\n`;
	return span;
}

function write(report: Report): void {
	const { lines, summary } = format(report);
	document.title = `${summary.text} - hbt unit tests`;
	document.getElementById('result')?.replaceChildren(...[...lines, summary].map(span));

	// A script's text is serialized verbatim, not entity-escaped, so
	// run.mjs needs no decoding; escaping every `<` keeps a `</script>`
	// in a test name or message from closing the element early.
	const json = document.getElementById('report');
	if (json !== null) json.textContent = toJson(report).replaceAll('<', '\\u003c');
}

// JSON.stringify(report, null, '\t'), except that each test stays on
// one line, so the report reads like the page's in DevTools' Elements
// tab. It walks the report's own fields, so one added to Report
// cannot be left out, and an absent optional one is simply not there.
function toJson(report: Report): string {
	const tests = `[\n${report.tests.map((t) => `\t\t${JSON.stringify(t)}`).join(',\n')}\n\t]`;
	const fields = Object.entries(report).map(([k, v]) => {
		const value = k === 'tests' && report.tests.length > 0 ? tests : JSON.stringify(v);
		return `\t${JSON.stringify(k)}: ${value}`;
	});
	return `{\n${fields.join(',\n')}\n}`;
}
