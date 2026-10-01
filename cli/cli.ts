#!/usr/bin/env node
// The command line: arguments, files and exit codes, around a library
// that takes and returns strings. The only module that may use Node
// APIs.
//
// The flags, messages and exit codes follow hbt-rs's `cli/src/main.rs`:
// a usage error exits 2, as clap's do, and any other error exits 1,
// printed as anyhow prints one, with the error's causes beneath it.
// A usage error says more than hbt-rs's does, whose clap is built
// without its `error-context` feature and so names only the kind of
// mistake, `error: unexpected argument found`.
// `--schema` is left out, as hbt-go leaves it out: the schema is
// generated from hbt-rs's types and hbt-data carries the result.
import * as fs from 'node:fs';
import * as module from 'node:module';
import * as path from 'node:path';
import * as util from 'node:util';

import * as yaml from 'yaml';

import type { Collection } from '../src/collection.js';
import { type Label, mkLabel } from '../src/entity.js';
import { parseMarkdown } from '../src/markdown.js';
import { formatYaml } from '../src/yaml.js';

/** The `-f` values, shared by all five (henrytill/hbt-data#16). */
const INPUT_FORMATS = ['json', 'xml', 'markdown', 'html'] as const;
type InputFormat = (typeof INPUT_FORMATS)[number];

const OUTPUT_FORMATS = ['html', 'yaml'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** The extension is `md` where the format is `markdown`. */
const INPUT_EXTENSIONS = new Map<string, InputFormat>([['json', 'json'], ['xml', 'xml'], ['md', 'markdown'], ['html', 'html']]);
const OUTPUT_EXTENSIONS = new Map<string, OutputFormat>([['html', 'html'], ['yaml', 'yaml'], ['yml', 'yaml']]);

/**
 * Every option may be given only once, as in hbt-rs, where clap
 * refuses a second `-t` or even a second `--info`. `util.parseArgs`
 * would keep the last value silently, so each is parsed as `multiple`
 * and `once` refuses a repeat.
 */
const OPTIONS = {
	from: { type: 'string', short: 'f', multiple: true },
	to: { type: 'string', short: 't', multiple: true },
	output: { type: 'string', short: 'o', multiple: true },
	info: { type: 'boolean', multiple: true },
	'list-tags': { type: 'boolean', multiple: true },
	mappings: { type: 'string', multiple: true },
	help: { type: 'boolean', short: 'h', multiple: true },
	version: { type: 'boolean', short: 'V', multiple: true },
} as const satisfies util.ParseArgsOptionsConfig;

type Option = keyof typeof OPTIONS;

/** Each option's value name and description, which the type requires for every option. */
const DESCRIPTIONS: { readonly [K in Option]: readonly [value: string, text: string] } = {
	from: ['<FROM>', `Input format [possible values: ${INPUT_FORMATS.join(', ')}]`],
	to: ['<TO>', `Output format [possible values: ${OUTPUT_FORMATS.join(', ')}]`],
	output: ['<OUTPUT>', 'Output file (defaults to stdout)'],
	info: ['', 'Show collection info (entity count)'],
	'list-tags': ['', 'List all tags'],
	mappings: ['<FILE>', 'Read mappings from <FILE>'],
	help: ['', 'Print help'],
	version: ['', 'Print version'],
};

/** An option as its help line names it, `-t, --to <TO>`. */
function spelling(option: Option): string {
	const short = 'short' in OPTIONS[option] ? `-${OPTIONS[option].short}, ` : '    ';
	const [value] = DESCRIPTIONS[option];
	return `${short}--${option}${value && ` ${value}`}`;
}

const HELP = [
	'Heterogeneous Bookmark Transformation',
	'',
	'Usage: hbt [OPTIONS] [FILE]',
	'',
	'Arguments:',
	'  [FILE]  Input file',
	'',
	'Options:',
	...(Object.keys(OPTIONS) as Option[]).map((option) => `  ${spelling(option).padEnd(23)}  ${DESCRIPTIONS[option][1]}`),
	'',
].join('\n');

/** An error in the arguments themselves, which exits 2. */
class UsageError extends Error {
	override readonly name = 'UsageError';
}

/** Runs `f`, giving any error it throws `message` and the error as its cause. */
function withContext<T>(message: string, f: () => T): T {
	try {
		return f();
	} catch (cause) {
		throw new Error(message, { cause });
	}
}

/** Runs `f`, turning the errors `util.parseArgs` throws into a `UsageError`. */
function withUsage<T>(f: () => T): T {
	try {
		return f();
	} catch (error) {
		if (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS_')) {
			throw new UsageError(error.message);
		}
		throw error;
	}
}

function parseArguments(args: string[]) {
	const { values, positionals } = withUsage(() => util.parseArgs({ args, allowPositionals: true, options: OPTIONS }));
	const [file, unexpected] = positionals;
	if (unexpected !== undefined) {
		throw new UsageError(`unexpected argument '${unexpected}' found`);
	}
	return {
		from: choose(INPUT_FORMATS, 'from', once('from', values.from)),
		to: choose(OUTPUT_FORMATS, 'to', once('to', values.to)),
		output: once('output', values.output),
		info: once('info', values.info),
		listTags: once('list-tags', values['list-tags']),
		mappings: once('mappings', values.mappings),
		help: once('help', values.help),
		version: once('version', values.version),
		file,
	};
}

/** The one value of an option, refusing a second. */
function once<T>(option: Option, values: readonly T[] | undefined): T | undefined {
	if (values !== undefined && values.length > 1) {
		throw new UsageError(`the argument '${spelling(option)}' cannot be used multiple times`);
	}
	return values?.[0];
}

function choose<T extends string>(choices: readonly T[], option: Option, value: string | undefined): T | undefined {
	if (value === undefined || (choices as readonly string[]).includes(value)) {
		return value as T | undefined;
	}
	throw new UsageError(`invalid value '${value}' for '${spelling(option)}' [possible values: ${choices.join(', ')}]`);
}

/** The format a file's extension names, if it names one. */
const detect = <T>(formats: ReadonlyMap<string, T>, file: string): T | undefined => formats.get(path.extname(file).slice(1));

/**
 * The version, and the commit it was built from when the build said.
 * The Nix package's wrapper sets `HBT_COMMIT_SHORT_HASH`, the variable
 * hbt-rs's flake bakes in, so the output matches hbt-rs's
 * `hbt 0.1.0 (7e16a14)`; hbt-analysis reads it to record which build
 * produced a measurement.
 */
function version(): string {
	// By the package's own name, which node resolves through `exports`
	// wherever the package is, so this does not depend on where the
	// build puts this file. A JSON import would make tsc copy
	// package.json into dist/tsc/, which the published files leave out.
	const { version } = module.createRequire(import.meta.url)('hbt/package.json') as { version: string };
	const commit = process.env['HBT_COMMIT_SHORT_HASH'];
	return commit ? `${version} (${commit})` : version;
}

/**
 * Decodes UTF-8, refusing a malformed sequence rather than replacing
 * it, as Rust's `read_to_string` does. A byte-order mark is kept, as
 * Rust keeps it, not stripped.
 */
const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

function parse(format: InputFormat, input: string): Collection {
	switch (format) {
		case 'markdown':
			return parseMarkdown(input);
		case 'json':
		case 'xml':
		case 'html':
			throw new Error(`there is no ${format} parser yet`);
	}
}

function unparse(format: OutputFormat, collection: Collection): string {
	switch (format) {
		case 'yaml':
			return formatYaml(collection);
		case 'html':
			throw new Error('There is no html formatter yet');
	}
}

/**
 * Reads a mappings file: a YAML mapping of old label to new, which an
 * empty string maps to nothing, dropping the label (henrytill/hbt-go#73).
 * An entry that is not a pair of strings is an error rather than
 * skipped, as in hbt-rs, where a skipped typo left the labels it was
 * meant to rewrite untouched with no indication why.
 */
function readMappings(file: string): [Label, Label | null][] {
	const contents = withContext(`Could not read mappings file: ${file}`, () => decode(fs.readFileSync(file)));
	// As Maps, since an object would turn a key of `42` into `'42'`.
	const doc: unknown = withContext(`Could not parse mappings file: ${file}`, () => yaml.parse(contents, { mapAsMap: true }));
	if (!(doc instanceof Map)) {
		throw new Error('Mapping file must contain a YAML mapping');
	}
	return [...doc].map(([key, value]: [unknown, unknown]) => {
		if (typeof key !== 'string') {
			throw new Error('Mapping file keys must be strings');
		}
		if (typeof value !== 'string') {
			throw new Error(`Mapping for ${JSON.stringify(key)} must be a string`);
		}
		return [mkLabel(key), value === '' ? null : mkLabel(value)];
	});
}

/**
 * Writes `text` to `output`, or to stdout without one. The text is
 * whole before the file is created, so a formatter that fails leaves
 * no empty file behind.
 */
function write(output: string | undefined, text: string): void {
	if (output === undefined) {
		process.stdout.write(text);
		return;
	}
	withContext(`Could not create output file: ${output}`, () => fs.writeFileSync(output, text));
}

/**
 * The flags do not compose: they short-circuit in hbt-rs's order,
 * `--info`, then `--list-tags`, then `-t` or `-o`, and the first two
 * write to stdout whatever `-o` says.
 */
function main(args: string[]): void {
	const options = parseArguments(args);
	if (options.help) {
		process.stdout.write(HELP);
		return;
	}
	if (options.version) {
		process.stdout.write(`hbt ${version()}\n`);
		return;
	}

	const file = options.file;
	if (file === undefined) {
		throw new Error('Input file required');
	}
	const from = options.from ?? detect(INPUT_EXTENSIONS, file);
	if (from === undefined) {
		throw new Error(`No parser for file: ${file}`);
	}
	const bytes = withContext(`Could not open input file: ${file}`, () => fs.readFileSync(file));
	const collection = withContext(`Could not parse ${file}`, () => parse(from, decode(bytes)));
	if (options.mappings !== undefined) {
		collection.updateLabels(readMappings(options.mappings));
	}

	if (options.info) {
		process.stdout.write(`${file}: ${collection.length} entities\n`);
		return;
	}
	if (options.listTags) {
		process.stdout.write(collection.labels().map((label) => `${label}\n`).join(''));
		return;
	}
	const to = options.to ?? (options.output !== undefined ? detect(OUTPUT_EXTENSIONS, options.output) : undefined);
	if (to === undefined) {
		throw new Error('Must specify an output format (-t) or analysis flag (--info, --list-tags)');
	}
	write(options.output, unparse(to, collection));
}

/** An error and its causes, as anyhow's `Debug` prints them. */
function report(error: unknown): string {
	const messages: string[] = [];
	for (let e: unknown = error; e !== undefined; e = e instanceof Error ? e.cause : undefined) {
		messages.push(e instanceof Error ? e.message : String(e));
	}
	const [message, ...causes] = messages;
	let out = `Error: ${message}\n`;
	if (causes.length === 1) {
		out += `\nCaused by:\n    ${causes[0]}\n`;
	} else if (causes.length > 1) {
		out += `\nCaused by:\n${causes.map((cause, i) => `    ${i}: ${cause}\n`).join('')}`;
	}
	return out;
}

// Setting `exitCode` rather than calling `process.exit` lets a large
// write to a pipe finish.
try {
	main(process.argv.slice(2));
} catch (error) {
	if (error instanceof UsageError) {
		process.stderr.write(`error: ${error.message}\n`);
		process.exitCode = 2;
	} else {
		process.stderr.write(report(error));
		process.exitCode = 1;
	}
}
