// Runs the unit tests' browser bundle (see scripts/build.mjs): the
// stand-in for `node:test` in test.ts registers each test here, and
// run runs them and writes the outcome into the page twice - as lines
// in <pre id="result"> for a person, and as JSON in
// <script id="report"> for scripts/test-browser.mjs, which reads it
// back from `chromium --dump-dom` and prints the same lines. Kept out
// of test.ts, which the tests' paths map node:test to, so that the
// stand-in exports nothing node:test lacks: this run is not
// node:test's run(options), and a test importing run from node:test
// fails to typecheck rather than reaching it.

// Declared by hand rather than through lib "dom", which would let the
// library reach for browser globals too.
type Element = { className: string; textContent: string | null; replaceChildren(...nodes: (Element | string)[]): void };
declare const document: {
	title: string;
	getElementById(id: string): Element | null;
	createElement(tag: string): Element;
};
declare const navigator: { userAgent: string };

export type Test = { readonly suites: readonly string[]; readonly name: string; readonly fn: () => unknown };
type Result = { readonly suites: readonly string[]; readonly name: string; readonly ok: boolean; readonly error?: string };
type Outcome = { readonly tests: readonly Result[]; readonly loadError?: string };
type Line = { readonly className: string; readonly text: string };
type Formatted = { readonly lines: readonly Line[]; readonly summary: Line; readonly passed: boolean };

const tests: Test[] = [];

export function register(test: Test): void {
	tests.push(test);
}

// `load` evaluates the test files (see scripts/build.mjs), inside the
// try so that a throw while loading - a test file's describe, or a
// library module's top level - is reported with its message. Left to
// reach the page as an uncaught error, Chrome would mute it to "Script
// error." for a script from a file:// URL.
export async function run(load: () => void): Promise<void> {
	try {
		load();
	} catch (e) {
		write({ tests: [], loadError: String(e) });
		return;
	}
	// Nothing registered means the test files' describe and it reached
	// another copy of this module, or none were loaded at all; either
	// way an empty run would otherwise report PASS 0.
	if (tests.length === 0) {
		write({ tests: [], loadError: 'no tests registered' });
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
	write({ tests: results });
}

// The outcome as text - a line per test and error, and a summary -
// which the page shows and the report carries, so that
// scripts/test-browser.mjs prints the same lines without formatting
// them itself. className is what the page's stylesheet colours each
// line by.
function format(report: Outcome): Formatted {
	const lines: Line[] = [];
	for (const { suites, name, ok, error } of report.tests) {
		lines.push({ className: ok ? 'pass' : 'fail', text: `${ok ? 'ok' : 'not ok'} - ${[...suites, name].join(' > ')}` });
		if (error !== undefined) lines.push({ className: 'error', text: error.replaceAll(/^/gm, '  ') });
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

function write(outcome: Outcome): void {
	const report = { userAgent: navigator.userAgent, ...format(outcome) };
	const { lines, summary } = report;
	document.title = `${summary.text} - hbt unit tests`;
	document.getElementById('result')?.replaceChildren(...[...lines, summary].map(span));

	// A script's text is serialized verbatim, not entity-escaped, so
	// scripts/test-browser.mjs needs no decoding; escaping every `<`
	// keeps a `</script>` in a test name or message from closing the
	// element early.
	const json = document.getElementById('report');
	if (json !== null) json.textContent = JSON.stringify(report, null, '\t').replaceAll('<', '\\u003c');
}
