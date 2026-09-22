import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Collection } from './collection.js';
import { mkEntity, mkLabel, mkTime, mkUrl } from './entity.js';

const a = mkEntity({ url: mkUrl('https://a.example/') });
const b = mkEntity({ url: mkUrl('https://b.example/') });

describe('Collection', () => {
	it('starts empty', () => {
		const collection = new Collection();
		assert.equal(collection.length, 0);
		assert.ok(collection.isEmpty);
	});

	it('indexes inserted entities by URL', () => {
		const collection = new Collection();
		const id = collection.insert(a);
		assert.ok(collection.contains(a.url));
		assert.deepEqual(collection.id(a.url), id);
		assert.equal(collection.entity(id), a);
		assert.equal(collection.id(b.url), undefined);
	});

	it('upsert merges into the existing node rather than adding one', () => {
		const collection = new Collection();
		const first = collection.upsert(mkEntity({ ...a, createdAt: mkTime(20) }));
		const second = collection.upsert(mkEntity({ ...a, createdAt: mkTime(10) }));
		assert.equal(collection.length, 1);
		assert.deepEqual(first, second);
		assert.equal(collection.entity(first).createdAt, 10);
	});

	it('adds an edge once, and both ways with addEdges', () => {
		const collection = new Collection();
		const x = collection.insert(a);
		const y = collection.insert(b);
		collection.addEdge(x, y);
		collection.addEdge(x, y);
		assert.deepEqual(collection.edges(x), [y]);
		assert.deepEqual(collection.edges(y), []);
		collection.addEdges(x, y);
		assert.deepEqual(collection.edges(y), [x]);
	});

	it('refuses an Id from another collection', () => {
		const other = new Collection();
		const foreign = other.insert(a);
		assert.throws(() => new Collection().entity(foreign), /different collection/);
	});

	it('replaces labels according to the mappings', () => {
		const collection = new Collection();
		const id = collection.insert(mkEntity({ ...a, labels: new Set([mkLabel('old'), mkLabel('keep')]) }));
		collection.updateLabels([[mkLabel('old'), mkLabel('new')]]);
		assert.deepEqual([...collection.entity(id).labels].sort(), ['keep', 'new']);
	});

	it('leaves a node whose labels are untouched exactly as it was', () => {
		const collection = new Collection();
		const id = collection.insert(mkEntity({ ...a, labels: new Set([mkLabel('keep')]) }));
		const before = collection.entity(id);
		collection.updateLabels([[mkLabel('old'), mkLabel('new')]]);
		assert.equal(collection.entity(id), before);
	});
});
