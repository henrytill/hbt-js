// The CLI as a process, after hbt-rs's cli/tests/cli.rs: what the
// conformance harness does not reach, which is every flag but `-t` and
// every failure. Node only, so build.mjs leaves it out of the browser
// run.
import assert from 'node:assert/strict';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import * as url from 'node:url';

const CLI = url.fileURLToPath(new URL('./cli.js', import.meta.url));

const DOCUMENT = `# November 15, 2023

## Foo

- [One](https://one.test/)

## Bar

- [Two](https://two.test/)
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbt-cli-'));

/** Writes `contents` to a file named `name` in the scratch directory. */
function scratch(name: string, contents: string): string {
	const file = path.join(dir, name);
	fs.writeFileSync(file, contents);
	return file;
}

const INPUT = scratch('input.md', DOCUMENT);

function hbt(...args: string[]) {
	const { status, stdout, stderr } = child_process.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
	return { status, stdout, stderr };
}

const ok = (stdout: string) => ({ status: 0, stdout, stderr: '' });
const failure = (stderr: string) => ({ status: 1, stdout: '', stderr });

describe('hbt', () => {
	it('counts entities with --info', () => {
		assert.deepEqual(hbt('--info', INPUT), ok(`${INPUT}: 2 entities\n`));
	});

	it('lists labels sorted with --list-tags', () => {
		assert.deepEqual(hbt('--list-tags', INPUT), ok('Bar\nFoo\n'));
	});

	it('rewrites labels with --mappings, dropping one mapped to the empty string', () => {
		const mappings = scratch('mappings.yaml', 'Foo: Renamed\nBar: ""\n');
		assert.deepEqual(hbt('--list-tags', '--mappings', mappings, INPUT), ok('Renamed\n'));
	});

	it('writes the same YAML to -o as to stdout, the format from its extension', () => {
		const out = path.join(dir, 'out.yml');
		assert.deepEqual(hbt('-o', out, INPUT), ok(''));
		assert.equal(fs.readFileSync(out, 'utf8'), hbt('-t', 'yaml', INPUT).stdout);
	});

	it('reads the format given by -f over the extension', () => {
		const input = scratch('input.txt', DOCUMENT);
		assert.deepEqual(hbt('-f', 'markdown', '--info', input), ok(`${input}: 2 entities\n`));
	});

	it('prints the version, with the commit when the build gives one', () => {
		assert.match(hbt('--version').stdout, /^hbt \d+\.\d+\.\d+\n$/);
		const { status, stdout } = child_process.spawnSync(process.execPath, [CLI, '-V'], {
			encoding: 'utf8',
			env: { ...process.env, HBT_COMMIT_SHORT_HASH: '7e16a14' },
		});
		assert.equal(status, 0);
		assert.match(stdout, /^hbt \d+\.\d+\.\d+ \(7e16a14\)\n$/);
	});

	it('names the file a parse error came from, and the cause', () => {
		const input = scratch('no-date.md', '- [Foo](https://foo.test/)\n');
		assert.deepEqual(hbt('-t', 'yaml', input), failure(`Error: Could not parse ${input}\n\nCaused by:\n    missing date\n`));
	});

	it('refuses malformed UTF-8 rather than replacing it', () => {
		const input = scratch('malformed.md', '');
		fs.writeFileSync(input, new Uint8Array([0xff]));
		assert.equal(hbt('-t', 'yaml', input).status, 1);
	});

	it('names a missing input file', () => {
		const { status, stderr } = hbt('-t', 'yaml', path.join(dir, 'missing.md'));
		assert.equal(status, 1);
		assert.ok(stderr.startsWith(`Error: Could not open input file: ${path.join(dir, 'missing.md')}\n\nCaused by:\n`), stderr);
	});

	it('requires an input file', () => {
		assert.deepEqual(hbt(), failure('Error: Input file required\n'));
	});

	it('requires an output format or an analysis flag', () => {
		assert.deepEqual(hbt(INPUT), failure('Error: Must specify an output format (-t) or analysis flag (--info, --list-tags)\n'));
	});

	it('refuses a file whose extension names no format', () => {
		const input = scratch('input.txt', DOCUMENT);
		assert.deepEqual(hbt('-t', 'yaml', input), failure(`Error: No parser for file: ${input}\n`));
	});

	it('refuses a mappings value that is not a string', () => {
		const mappings = scratch('numeric.yaml', 'Foo: 42\n');
		assert.deepEqual(hbt('--list-tags', '--mappings', mappings, INPUT), failure('Error: Mapping for "Foo" must be a string\n'));
	});

	it('refuses a mappings file that is not a mapping', () => {
		const mappings = scratch('list.yaml', '- just\n- a\n- list\n');
		assert.deepEqual(hbt('--info', '--mappings', mappings, INPUT), failure('Error: Mapping file must contain a YAML mapping\n'));
	});

	// `md` is the extension, not the format (henrytill/hbt-data#16).
	it('exits 2 on a usage error, such as -f md', () => {
		assert.equal(hbt('-f', 'md', '--info', INPUT).status, 2);
		assert.equal(hbt('--no-such-flag', INPUT).status, 2);
		assert.equal(hbt('-t', 'yaml', INPUT, INPUT).status, 2);
	});
});
