import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ParseError, mkEntity, entityEquals, entityMerge, mkExtended, mkLabel, mkName, mkTime, mkUrl } from './entity.js';

const testUrl = mkUrl('https://example.com/');

describe('mkUrl', () => {
	it('normalizes to the WHATWG form', () => {
		assert.equal(mkUrl('https://EXAMPLE.com'), 'https://example.com/');
	});

	it('rejects a string that is not a URL', () => {
		assert.throws(() => mkUrl('not a url'), ParseError);
	});
});

describe('mkTime', () => {
	it('truncates to whole seconds', () => {
		assert.equal(mkTime(1.9), 1);
		assert.equal(mkTime(new Date(1500)), 1);
	});

	it('rejects a value outside the safe integer range', () => {
		assert.throws(() => mkTime(Number.NaN), ParseError);
	});
});

describe('mkEntity', () => {
	it('drops an update that repeats createdAt', () => {
		const entity = mkEntity({ url: testUrl, createdAt: mkTime(10), updatedAt: new Set([mkTime(10), mkTime(20)]) });
		assert.deepEqual([...entity.updatedAt], [20]);
	});

	it('keeps an update strictly below createdAt', () => {
		const entity = mkEntity({ url: testUrl, createdAt: mkTime(10), updatedAt: new Set([mkTime(5)]) });
		assert.deepEqual([...entity.updatedAt], [5]);
	});
});

describe('entityMerge', () => {
	it('keeps the earlier creation time and demotes the later one to an update', () => {
		const merged = entityMerge(mkEntity({ url: testUrl, createdAt: mkTime(20) }), mkEntity({ url: testUrl, createdAt: mkTime(10) }));
		assert.equal(merged.createdAt, 10);
		assert.deepEqual([...merged.updatedAt], [20]);
	});

	it('treats an absent creation time as the identity', () => {
		const merged = entityMerge(mkEntity({ url: testUrl }), mkEntity({ url: testUrl, createdAt: mkTime(10) }));
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
			mkEntity({ url: testUrl, names: new Set([mkName('b')]), labels: new Set([mkLabel('y')]) }),
		);
		assert.deepEqual(merged.names, new Set([mkName('a'), mkName('b')]));
		assert.deepEqual(merged.labels, new Set([mkLabel('x'), mkLabel('y')]));
		assert.deepEqual([...merged.extended], ['e']);
	});

	it('combines flags with or, and an absent flag stays absent', () => {
		const merged = entityMerge(mkEntity({ url: testUrl, shared: false, toRead: true }), mkEntity({ url: testUrl, shared: true }));
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
