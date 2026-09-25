import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Collection } from './collection.js';
import { ParseError } from './entity.js';
import { parseMarkdown } from './markdown.js';

/** Each node as plain data, its sets sorted, in insertion order. */
const summary = (collection: Collection) =>
	collection.ids().map((id) => {
		const entity = collection.entity(id);
		return {
			url: entity.url as string,
			createdAt: entity.createdAt,
			updatedAt: [...entity.updatedAt].sort((a, b) => a - b),
			names: [...entity.names].sort(),
			labels: [...entity.labels].sort(),
			edges: collection.edges(id).map((edge) => edge.index),
		};
	});

const NOV_15 = 1700006400;
const DATED = '# November 15, 2023\n\n';

/** The names of the bookmarks `input` makes, in order. */
const names = (input: string): string[][] => summary(parseMarkdown(DATED + input)).map((node) => node.names);

/** The labels of the bookmarks `input` makes, in order. */
const labels = (input: string): string[][] => summary(parseMarkdown(DATED + input)).map((node) => node.labels);

describe('parseMarkdown', () => {
	it('reads nothing from an empty document', () => {
		assert.equal(parseMarkdown('').length, 0);
	});

	it('makes a bookmark of each link, dated by the H1 above it', () => {
		assert.deepEqual(summary(parseMarkdown(DATED + '- [Foo](https://foo.com)\n- <https://bar.com>\n')), [
			{ url: 'https://foo.com/', createdAt: NOV_15, updatedAt: [], names: ['Foo'], labels: [], edges: [] },
			{ url: 'https://bar.com/', createdAt: NOV_15, updatedAt: [], names: [], labels: [], edges: [] },
		]);
	});

	it('merges a URL seen under several dates, the earliest being its creation', () => {
		const input = [
			'# December 6, 2023',
			'- [Foo](https://foo.com)',
			'# December 5, 2023',
			'- [Bar](https://foo.com)',
			'# December 7, 2023',
			'- [Baz](https://foo.com)',
		].join('\n\n');
		const [node, ...rest] = summary(parseMarkdown(input));
		assert.equal(rest.length, 0);
		assert.equal(node?.createdAt, 1701734400);
		assert.deepEqual(node?.updatedAt, [1701820800, 1701907200]);
		assert.deepEqual(node?.names, ['Bar', 'Baz', 'Foo']);
	});

	it('labels a link with each heading above it, down from H2', () => {
		const input = '## A\n\n### B\n\n- <https://a.com>\n\n## C\n\n#### D\n\n- <https://b.com>\n\n### E\n\n- <https://c.com>\n';
		assert.deepEqual(labels(input), [['A', 'B'], ['C', 'D'], ['C', 'E']]);
	});

	it('clears the labels at the next H1', () => {
		assert.deepEqual(summary(parseMarkdown(DATED + '## A\n\n# November 16, 2023\n\n- <https://a.com>\n'))[0]?.labels, []);
	});

	it('joins a nested link to the one it is under, both ways', () => {
		const input = '- [A](https://a.com)\n  - [B](https://b.com)\n    - [C](https://c.com)\n  - [D](https://d.com)\n';
		assert.deepEqual(
			summary(parseMarkdown(DATED + input)).map((node) => node.edges),
			[[1, 3], [0, 2], [1], [0]],
		);
	});

	it('does not join the items of a list that starts indented', () => {
		const input = '  - [A](https://a.com)\n- [B](https://b.com)\n';
		assert.deepEqual(
			summary(parseMarkdown(DATED + input)).map((node) => node.edges),
			[[], []],
		);
	});

	it('parents a list under a bare link in the paragraph above it, as hbt-rs does', () => {
		const input = '[A](https://a.com)\n\n- [B](https://b.com)\n';
		assert.deepEqual(
			summary(parseMarkdown(DATED + input)).map((node) => node.edges),
			[[1], [0]],
		);
	});

	it('keeps code spans in a name, backticks and all', () => {
		assert.deepEqual(names('- [Hello `Foo`, world!](https://foo.com)\n'), [['Hello `Foo`, world!']]);
	});

	it('ends a name at emphasis inside it, as hbt-rs does', () => {
		assert.deepEqual(names('- [Hello *world* again](https://foo.com)\n'), [['Hello ']]);
		assert.deepEqual(names('- [![i](https://i.com) after](https://foo.com)\n'), [[]]);
	});

	it('joins the pieces of a line broken inside a name', () => {
		assert.deepEqual(names('[A\nB](https://foo.com)\n'), [['AB']]);
	});

	it('takes a heading holding only emphasis as no label', () => {
		assert.deepEqual(labels('## **Foo**\n\n- <https://a.com>\n'), [[]]);
	});

	it('takes escaped text in a heading as one label, where hbt-rs splits it', () => {
		assert.deepEqual(labels('## Foo\\*bar &amp; baz\n\n- <https://a.com>\n'), [['Foo*bar & baz']]);
	});

	it('keeps a destination as written, for the URL parser to normalize', () => {
		const urls = summary(parseMarkdown(DATED + '- <https://x.com/a[b]?c|d>\n- [A](javascript:void)\n- <HTTPS://A.COM/>\n')).map(
			(node) => node.url,
		);
		assert.deepEqual(urls, ['https://x.com/a[b]?c|d', 'javascript:void', 'https://a.com/']);
	});

	it('refuses a reference link or an email autolink, as hbt-rs does', () => {
		assert.throws(() => parseMarkdown(DATED + '- [A][r]\n\n[r]: https://r.com\n'), ParseError);
		assert.throws(() => parseMarkdown(DATED + '- <a@b.com>\n'), ParseError);
		assert.equal(parseMarkdown(DATED + '- <mailto:a@b.com>\n').length, 1);
	});

	it('refuses a link before any date, or with a relative URL', () => {
		assert.throws(() => parseMarkdown('- [A](https://a.com)\n'), ParseError);
		assert.throws(() => parseMarkdown(DATED + '- [A](/a)\n'), ParseError);
	});

	it('refuses lists nested past its limit rather than dropping the deepest', () => {
		const nested = (depth: number) => Array.from({ length: depth }, (_, i) => `${'  '.repeat(i)}- <https://a.com/${i}>\n`).join('');
		assert.equal(parseMarkdown(DATED + nested(99)).length, 99);
		assert.throws(() => parseMarkdown(DATED + nested(100)), ParseError);
		assert.throws(() => parseMarkdown(DATED + '>'.repeat(5000) + ' <https://a.com>\n'), ParseError);
	});

	it('reads dates as chrono reads `%B %-d, %Y`', () => {
		const createdAt = (date: string) => summary(parseMarkdown(`# ${date}\n\n- <https://a.com>\n`))[0]?.createdAt;
		assert.equal(createdAt('November 15, 2023'), NOV_15);
		assert.equal(createdAt('nov 15,2023'), NOV_15);
		assert.equal(createdAt('NOVEMBER  15, 2023'), NOV_15);
		assert.equal(createdAt('November15, 2023'), NOV_15);
		assert.equal(createdAt('February 29, 2024'), 1709164800);
		// A year is taken as written, not as 1900 plus it.
		assert.equal(createdAt('November 5, 23'), -61414761600);
		assert.equal(createdAt('November 5, +12023'), 317268662400);
		assert.equal(createdAt('November 5, -1'), -62172144000);
		for (
			const date of [
				'November 5 2023',
				'November 5 , 2023',
				'Nov. 5, 2023',
				'Sept 5, 2023',
				'Novemberr 5, 2023',
				'November 5, 02023',
				'November 005, 2023',
				'February 29, 2023',
				'November 31, 2023',
				'November 0, 2023',
				'November 5, +262143',
			]
		) {
			assert.throws(() => createdAt(date), ParseError, date);
		}
	});
});
