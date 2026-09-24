// Runs the unit tests' browser bundle (see build.mjs) in headless
// Chromium or Chrome and exits non-zero unless every test passed.
// The browser is `chromium` on PATH, or whatever CHROMIUM names:
//
//   CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';

const browser = process.env['CHROMIUM'] ?? 'chromium';
const page = url.pathToFileURL(path.resolve('dist/test/browser/index.html')).href;

// A fresh profile each run: the default one may be locked by a
// browser already open, and HOME may not be writable (under Nix).
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hbt-browser-'));
let result;
try {
	result = childProcess.spawnSync(
		browser,
		// --no-sandbox because Chromium's sandbox needs user namespaces,
		// which the Nix build sandbox does not offer; the page is our own.
		[
			'--headless',
			'--no-sandbox',
			'--disable-gpu',
			`--user-data-dir=${profile}`,
			'--virtual-time-budget=10000',
			'--dump-dom',
			page,
		],
		// Chromium logs dbus and GPU complaints on stderr whatever
		// happens; the outcome is in the page on stdout.
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
	);
} finally {
	fs.rmSync(profile, { recursive: true, force: true });
}

if (result.error !== undefined) {
	console.error(`cannot run ${browser}: ${result.error.message}; set CHROMIUM to a Chromium or Chrome binary`);
	process.exit(2);
}

// test/browser/test.ts writes its report as JSON into the empty
// <script id="report">, whose text the page serializes verbatim, so
// all that is left to parse is the JSON. Still empty means the bundle
// never got as far as writing it, which fails too.
const json = /<script type="application\/json" id="report">([\s\S]*?)<\/script>/.exec(result.stdout)?.[1];
if (json === undefined || json === '') {
	console.error(`no report in the page ${browser} returned`);
	process.exit(1);
}
const report = JSON.parse(json);
console.log(`# ${report.userAgent}`);
if (report.loadError !== undefined) {
	console.error(`the tests did not load: ${report.loadError}`);
	process.exit(1);
}
let failed = 0;
for (const { suites, name, ok, error } of report.tests) {
	console.log(`${ok ? 'ok' : 'not ok'} - ${[...suites, name].join(' > ')}`);
	if (!ok) {
		failed += 1;
		console.log(`  ${error}`);
	}
}
console.log(failed === 0 ? `PASS ${report.tests.length}` : `FAIL ${failed} of ${report.tests.length}`);
process.exitCode = failed === 0 ? 0 : 1;
