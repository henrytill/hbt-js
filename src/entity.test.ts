import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type EntityInit, ParseError, mkEntity, entityEquals, entityMerge, mkExtended, mkLabel, mkName, mkTime, mkUrl } from './entity.js';

const testUrl = mkUrl('https://example.com/');

describe('mkUrl', () => {
	it('normalizes to the WHATWG form', () => {
		assert.equal(mkUrl('https://EXAMPLE.com'), 'https://example.com/');
	});

	it('gives the spec form where the platforms disagree', () => {
		const cases: [string, string][] = [
			['https://x.com/a|b^c', 'https://x.com/a|b%5Ec'], // Chromium encodes |; node 22 and hbt-rs leave ^
			['https://x.com/a%7Cb', 'https://x.com/a%7Cb'], // stays apart from a raw |
			["https://a'b@x.com/", "https://a'b@x.com/"], // Chromium encodes '
			["foo://h/?a'b", "foo://h/?a'b"], // Chromium encodes ' in a non-special query
			['https://a*b.com/', 'https://a*b.com/'], // Chromium encodes * in a host
			['foo:a b ?q', 'foo:a b%20?q'], // hbt-rs leaves the space before ? raw
			['file:///C|/x', 'file:///C:/x'], // hbt-rs and Chromium keep the |
		];
		for (const [input, expected] of cases) {
			assert.equal(mkUrl(input), expected);
		}
	});

	it('rejects a host the spec forbids', () => {
		assert.throws(() => mkUrl('https://a b.com/'), ParseError);
		assert.throws(() => mkUrl('https://x\u200d.com/'), ParseError);
	});

	it('rejects a string that is not a URL', () => {
		assert.throws(() => mkUrl('not a url'), ParseError);
	});
});

describe('mkName, mkLabel, mkExtended', () => {
	it('refuse the empty string, which does not round-trip', () => {
		assert.throws(() => mkName(''), ParseError);
		assert.throws(() => mkLabel(''), ParseError);
		assert.throws(() => mkExtended(''), ParseError);
	});
});

describe('mkTime', () => {
	it('floors to whole seconds', () => {
		assert.equal(mkTime(1.9), 1);
		assert.equal(mkTime(new Date(1500)), 1);
	});

	it('floors a pre-epoch fraction to the second below, as hbt-rs does', () => {
		assert.equal(mkTime(new Date(-500)), -1);
		assert.equal(mkTime(-1.5), -2);
	});

	it('rejects a value that is not a representable instant', () => {
		assert.throws(() => mkTime(Number.NaN), ParseError);
		assert.throws(() => mkTime(9e15), ParseError);
		assert.throws(() => mkTime(-9e15), ParseError);
		assert.throws(() => mkTime(Number.POSITIVE_INFINITY), ParseError);
	});

	it('accepts the extremes of the representable range', () => {
		assert.equal(mkTime(8_640_000_000_000), 8_640_000_000_000);
		assert.equal(mkTime(-8_640_000_000_000), -8_640_000_000_000);
	});
});

describe('mkEntity', () => {
	it('drops an update that repeats createdAt', () => {
		const entity = mkEntity({
			url: testUrl,
			createdAt: mkTime(10),
			updatedAt: new Set([mkTime(10), mkTime(20)]),
		});
		assert.deepEqual([...entity.updatedAt], [20]);
	});

	it('keeps an update strictly below createdAt', () => {
		const entity = mkEntity({
			url: testUrl,
			createdAt: mkTime(10),
			updatedAt: new Set([mkTime(5)]),
		});
		assert.deepEqual([...entity.updatedAt], [5]);
	});
});

describe('entityEquals', () => {
	const full = mkEntity({
		url: testUrl,
		createdAt: mkTime(10),
		updatedAt: new Set([mkTime(5)]),
		names: new Set([mkName('n')]),
		labels: new Set([mkLabel('l')]),
		extended: new Set([mkExtended('x')]),
		shared: true,
		toRead: false,
		isFeed: true,
		lastVisitedAt: mkTime(9),
	});

	// One differing value per field of Entity. Each case is typed to
	// override the field it is keyed by -- a case that differs
	// somewhere else does not compile -- so a field added to the
	// entity needs a case here that really differs in it, and the
	// case then fails until entityEquals looks at that field.
	const differing: { readonly [K in keyof EntityInit]-?: { readonly [P in K]-?: NonNullable<EntityInit[P]> } } = {
		url: { url: mkUrl('https://other.example/') },
		createdAt: { createdAt: mkTime(11) },
		updatedAt: { updatedAt: new Set([mkTime(6)]) },
		names: { names: new Set([mkName('m')]) },
		labels: { labels: new Set([mkLabel('k')]) },
		extended: { extended: new Set([mkExtended('y')]) },
		shared: { shared: false },
		toRead: { toRead: true },
		isFeed: { isFeed: false },
		lastVisitedAt: { lastVisitedAt: mkTime(8) },
	};

	it('holds for an entity rebuilt from the same init', () => {
		assert.ok(entityEquals(full, mkEntity({ ...full })));
	});

	for (const [field, override] of Object.entries(differing)) {
		it(`fails when ${field} differs`, () => {
			assert.ok(!entityEquals(full, mkEntity({ ...full, ...override })));
		});
	}
});

describe('entityMerge', () => {
	it('keeps the earlier creation time and demotes the later one to an update', () => {
		const merged = entityMerge(
			mkEntity({ url: testUrl, createdAt: mkTime(20) }),
			mkEntity({ url: testUrl, createdAt: mkTime(10) }),
		);
		assert.equal(merged.createdAt, 10);
		assert.deepEqual([...merged.updatedAt], [20]);
	});

	it('treats an absent creation time as the identity', () => {
		const merged = entityMerge(
			mkEntity({ url: testUrl }),
			mkEntity({ url: testUrl, createdAt: mkTime(10) }),
		);
		assert.equal(merged.createdAt, 10);
		assert.equal(merged.updatedAt.size, 0);
	});

	it('leaves an undated pair undated', () => {
		const merged = entityMerge(
			mkEntity({ url: testUrl, names: new Set([mkName('a')]) }),
			mkEntity({ url: testUrl, names: new Set([mkName('b')]) }),
		);
		assert.equal(merged.createdAt, undefined);
		assert.equal(merged.updatedAt.size, 0);
	});

	it('unions names, labels and extended', () => {
		const merged = entityMerge(
			mkEntity({
				url: testUrl,
				names: new Set([mkName('a')]),
				labels: new Set([mkLabel('x')]),
				extended: new Set([mkExtended('e')]),
			}),
			mkEntity({
				url: testUrl,
				names: new Set([mkName('b')]),
				labels: new Set([mkLabel('y')]),
			}),
		);
		assert.deepEqual(merged.names, new Set([mkName('a'), mkName('b')]));
		assert.deepEqual(merged.labels, new Set([mkLabel('x'), mkLabel('y')]));
		assert.deepEqual([...merged.extended], ['e']);
	});

	it('combines flags with or, and an absent flag stays absent', () => {
		const merged = entityMerge(
			mkEntity({ url: testUrl, shared: false, toRead: true }),
			mkEntity({ url: testUrl, shared: true }),
		);
		assert.equal(merged.shared, true);
		assert.equal(merged.toRead, true);
		assert.equal(merged.isFeed, undefined);
	});

	it('keeps the most recent visit', () => {
		const merged = entityMerge(
			mkEntity({ url: testUrl, lastVisitedAt: mkTime(5) }),
			mkEntity({ url: testUrl, lastVisitedAt: mkTime(9) }),
		);
		assert.equal(merged.lastVisitedAt, 9);
	});

	it('is a no-op for an equal entity', () => {
		const entity = mkEntity({ url: testUrl, createdAt: mkTime(10), updatedAt: new Set([mkTime(5)]) });
		assert.equal(entityMerge(entity, mkEntity({ ...entity })), entity);
	});

	it('is associative however three mentions are bracketed', () => {
		const a = mkEntity({ url: testUrl, createdAt: mkTime(30) });
		const b = mkEntity({ url: testUrl, createdAt: mkTime(10) });
		const c = mkEntity({ url: testUrl, createdAt: mkTime(20) });
		const left = entityMerge(entityMerge(a, b), c);
		const right = entityMerge(a, entityMerge(b, c));
		assert.ok(entityEquals(left, right));
		assert.deepEqual(left.updatedAt, new Set([mkTime(20), mkTime(30)]));
	});
});
