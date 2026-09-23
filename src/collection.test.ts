import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Collection, Id } from './collection.js';
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
		const found = collection.id(a.url);
		// Compared by index and round-tripped, not with deepEqual:
		// node's deep equality does not look at #private fields, so
		// it holds between handles from different collections and
		// would not notice id() returning a foreign one.
		assert.ok(found !== undefined);
		assert.equal(found.index, id.index);
		assert.equal(collection.entity(found), a);
		assert.equal(collection.id(b.url), undefined);
	});

	it('insert does not deduplicate, leaving the index on the later node', () => {
		const collection = new Collection();
		const first = collection.insert(a);
		const second = collection.insert(a);
		assert.equal(collection.length, 2);
		assert.notEqual(first.index, second.index);
		assert.equal(collection.id(a.url)?.index, second.index);
	});

	it('upsert merges into the existing node rather than adding one', () => {
		const collection = new Collection();
		const first = collection.upsert(mkEntity({ ...a, createdAt: mkTime(20) }));
		const second = collection.upsert(mkEntity({ ...a, createdAt: mkTime(10) }));
		assert.equal(collection.length, 1);
		assert.equal(first.index, second.index);
		assert.equal(collection.entity(second).createdAt, 10);
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

	it('does not accept a bare object as an Id', () => {
		// Id holds its owner privately, so an object of the right
		// shape is not one.
		const collection = new Collection();
		collection.insert(a);
		// @ts-expect-error
		assert.throws(() => collection.entity({ index: 0, owner: {} }));
	});

	it("refuses an Id built without the issuing collection's token", () => {
		const collection = new Collection();
		collection.insert(a);
		assert.throws(() => collection.entity(new Id(0, {})), /different collection/);
	});

	it('refuses an Id from another collection', () => {
		const other = new Collection();
		const foreign = other.insert(a);
		assert.throws(() => new Collection().entity(foreign), /different collection/);
	});

	it('gives entities() callers a snapshot, not the live array', () => {
		const collection = new Collection();
		collection.insert(mkEntity({ ...a, labels: new Set([mkLabel('old')]) }));
		const before = collection.entities();
		collection.updateLabels([[mkLabel('old'), mkLabel('new')]]);
		assert.deepEqual([...before[0]!.labels], [mkLabel('old')]);
		assert.deepEqual([...collection.entities()[0]!.labels], [mkLabel('new')]);
	});

	it('replaces labels according to the mappings', () => {
		const collection = new Collection();
		const id = collection.insert(mkEntity({ ...a, labels: new Set([mkLabel('old'), mkLabel('keep')]) }));
		collection.updateLabels([[mkLabel('old'), mkLabel('new')]]);
		assert.deepEqual(collection.entity(id).labels, new Set([mkLabel('keep'), mkLabel('new')]));
	});

	it('drops a label mapped to null rather than replacing it', () => {
		const collection = new Collection();
		const id = collection.insert(mkEntity({ ...a, labels: new Set([mkLabel('drop'), mkLabel('keep')]) }));
		collection.updateLabels([[mkLabel('drop'), null]]);
		assert.deepEqual(collection.entity(id).labels, new Set([mkLabel('keep')]));
	});

	it('does not chain mappings within a pass', () => {
		const collection = new Collection();
		const id = collection.insert(mkEntity({ ...a, labels: new Set([mkLabel('a')]) }));
		collection.updateLabels([
			[mkLabel('a'), mkLabel('b')],
			[mkLabel('b'), mkLabel('c')],
		]);
		assert.deepEqual(collection.entity(id).labels, new Set([mkLabel('b')]));
	});

	it('collapses two labels mapped onto one name', () => {
		const collection = new Collection();
		const id = collection.insert(mkEntity({ ...a, labels: new Set([mkLabel('x'), mkLabel('y')]) }));
		collection.updateLabels([
			[mkLabel('x'), mkLabel('same')],
			[mkLabel('y'), mkLabel('same')],
		]);
		assert.deepEqual(collection.entity(id).labels, new Set([mkLabel('same')]));
	});

	it('leaves a node whose labels are untouched exactly as it was', () => {
		const collection = new Collection();
		const id = collection.insert(mkEntity({ ...a, labels: new Set([mkLabel('keep')]) }));
		const before = collection.entity(id);
		collection.updateLabels([[mkLabel('old'), mkLabel('new')]]);
		assert.equal(collection.entity(id), before);
	});
});
