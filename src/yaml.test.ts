import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as yaml from 'yaml';

import { Collection } from './collection.js';
import { mkEntity, mkExtended, mkLabel, mkName, mkTime, mkUrl } from './entity.js';
import { formatYaml } from './yaml.js';

// Read back as YAML 1.1, as the conformance harness's PyYAML does.
const readBack = (collection: Collection): any => yaml.parse(formatYaml(collection), { version: '1.1' });

describe('formatYaml', () => {
	it('writes markdown/basic as its expected.yaml reads', () => {
		const collection = new Collection();
		const createdAt = mkTime(1700092800);
		collection.upsert(
			mkEntity({ url: mkUrl('https://foo.com'), createdAt, names: new Set([mkName('Foo')]), labels: new Set([mkLabel('Foo')]) }),
		);
		collection.upsert(mkEntity({ url: mkUrl('https://bar.com'), createdAt, labels: new Set([mkLabel('Foo'), mkLabel('Bar')]) }));
		collection.upsert(
			mkEntity({
				url: mkUrl('https://example.com'),
				createdAt,
				names: new Set([mkName('Hello, world!')]),
				labels: new Set([mkLabel('Misc')]),
			}),
		);
		const node = (id: number, uri: string, names: string[], labels: string[]) => ({
			id,
			entity: { uri, createdAt: 1700092800, updatedAt: [], names, labels },
			edges: [],
		});
		assert.deepEqual(readBack(collection), {
			version: '0.1.0',
			length: 3,
			value: [
				node(0, 'https://foo.com/', ['Foo'], ['Foo']),
				node(1, 'https://bar.com/', [], ['Bar', 'Foo']),
				node(2, 'https://example.com/', ['Hello, world!'], ['Misc']),
			],
		});
	});

	it('writes every field, and leaves out the absent ones', () => {
		const collection = new Collection();
		const full = collection.insert(
			mkEntity({
				url: mkUrl('https://a.example/'),
				createdAt: mkTime(0),
				updatedAt: new Set([mkTime(30), mkTime(-5), mkTime(20)]),
				shared: false,
				toRead: true,
				isFeed: false,
				extended: new Set([mkExtended('b'), mkExtended('a')]),
				lastVisitedAt: mkTime(40),
			}),
		);
		const bare = collection.insert(mkEntity({ url: mkUrl('https://b.example/') }));
		collection.addEdges(bare, full);
		const [a, b] = readBack(collection).value;
		// A createdAt of 0 is an instant, not absence.
		assert.deepEqual(a.entity, {
			uri: 'https://a.example/',
			createdAt: 0,
			updatedAt: [-5, 20, 30],
			names: [],
			labels: [],
			shared: false,
			toRead: true,
			isFeed: false,
			extended: ['a', 'b'],
			lastVisitedAt: 40,
		});
		assert.deepEqual(b.entity, { uri: 'https://b.example/', updatedAt: [], names: [], labels: [] });
		assert.deepEqual(a.edges, [1]);
		assert.deepEqual(b.edges, [0]);
	});

	it('quotes the strings a YAML 1.1 reader would take for something else', () => {
		const texts = ['yes', 'off', 'y', '2024-01-01', '1:20', '0x1F', '1_000', '~', 'null', '1700092800', '<<', '='];
		const collection = new Collection();
		collection.insert(mkEntity({ url: mkUrl('https://a.example/'), names: new Set(texts.map(mkName)) }));
		const text = formatYaml(collection);
		const names: unknown[] = yaml.parse(text, { version: '1.1' }).value[0].entity.names;
		assert.deepEqual(new Set(names), new Set(texts));
		// PyYAML also refuses a plain `<<` or `=`, which this parser
		// reads back as strings either way; check that they are quoted.
		assert.ok(text.includes('- "<<"\n'));
		assert.ok(text.includes('- "="\n'));
	});

	it('escapes the characters PyYAML refuses or folds', () => {
		// Tab, DEL and C1 are outside PyYAML's printable set, or not
		// allowed plain; U+0085, U+2028 and U+2029 are line breaks to
		// YAML 1.1 and fold to a space or vanish unless escaped.
		const texts = ['a\tb', '\tlead', 'a\x7f', '\x80\x9f', 'a\x85b', 'x\u2028y', 'a\u2029', 'a\ufffe', 'a\nb', 'say "\\x"\x7f'];
		const collection = new Collection();
		collection.insert(mkEntity({ url: mkUrl('https://a.example/'), names: new Set(texts.map(mkName)) }));
		const text = formatYaml(collection);
		assert.ok(!/[\t\x7f-\x9f\u2028\u2029\ufffe]/.test(text));
		const names: unknown[] = yaml.parse(text, { version: '1.1' }).value[0].entity.names;
		assert.deepEqual(new Set(names), new Set(texts));
	});

	it('sorts by code point, not by UTF-16 code unit', () => {
		const collection = new Collection();
		const labels = ['\u{1F600}', '', 'b', 'a'];
		collection.insert(mkEntity({ url: mkUrl('https://a.example/'), labels: new Set(labels.map(mkLabel)) }));
		assert.deepEqual(readBack(collection).value[0].entity.labels, ['a', 'b', '', '\u{1F600}']);
	});

	it('writes both nodes a repeated insert leaves', () => {
		const collection = new Collection();
		const a = mkEntity({ url: mkUrl('https://a.example/') });
		collection.insert(a);
		collection.insert(a);
		const { length, value } = readBack(collection);
		assert.equal(length, 2);
		assert.deepEqual(value.map((n: { id: number }) => n.id), [0, 1]);
	});
});
