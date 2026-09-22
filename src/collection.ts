import { type Entity, type Label, type Url, mkEntity, entityMerge } from './entity.js';

/**
 * A handle on one node, valid only for the collection that issued it.
 *
 * The owning collection's token is held privately, which makes this nominal -- an object with the right shape is not an `Id`
 * -- and means a handle cannot be rebuilt for a different index, since nothing outside the issuing collection can obtain the
 * token to put in it.
 */
export class Id {
	readonly #owner: object;
	readonly index: number;

	constructor(index: number, owner: object) {
		this.index = index;
		this.#owner = owner;
	}

	/** True when this handle was issued by the collection holding `token`. */
	isOwnedBy(token: object): boolean {
		return this.#owner === token;
	}
}

/** A graph of entities: nodes plus adjacency lists, with a URL index so one URL is one node. */
export class Collection {
	readonly #token = {};
	#nodes: Entity[] = [];
	#edges: number[][] = [];
	#urls = new Map<Url, number>();

	#makeId(index: number): Id {
		return new Id(index, this.#token);
	}

	#checkId(id: Id): void {
		if (!id.isOwnedBy(this.#token)) {
			throw new Error('Id belongs to a different collection');
		}
		// Unreachable from outside, the token being unobtainable, but the node lookups assert non-null on this index.
		if (!Number.isInteger(id.index) || id.index < 0 || id.index >= this.#nodes.length) {
			throw new RangeError(`Id index out of range: ${id.index}`);
		}
	}

	get length(): number {
		return this.#nodes.length;
	}

	get isEmpty(): boolean {
		return this.length === 0;
	}

	contains(url: Url): boolean {
		return this.#urls.has(url);
	}

	id(url: Url): Id | undefined {
		const index = this.#urls.get(url);
		return index === undefined ? undefined : this.#makeId(index);
	}

	insert(entity: Entity): Id {
		const index = this.#nodes.length;
		this.#nodes.push(entity);
		this.#edges.push([]);
		this.#urls.set(entity.url, index);
		return this.#makeId(index);
	}

	/** Inserts the entity, or merges it into the node that already has its URL. */
	upsert(other: Entity): Id {
		const id = this.id(other.url);
		if (id === undefined) {
			return this.insert(other);
		}
		this.#nodes[id.index] = entityMerge(this.entity(id), other);
		return id;
	}

	addEdge(from: Id, to: Id): void {
		this.#checkId(from);
		this.#checkId(to);
		const edges = this.#edges[from.index]!;
		if (!edges.includes(to.index)) {
			edges.push(to.index);
		}
	}

	addEdges(from: Id, to: Id): void {
		this.addEdge(from, to);
		this.addEdge(to, from);
	}

	entity(id: Id): Entity {
		this.#checkId(id);
		return this.#nodes[id.index]!;
	}

	edges(id: Id): Id[] {
		this.#checkId(id);
		return this.#edges[id.index]!.map((index) => this.#makeId(index));
	}

	/** A snapshot of the nodes. Copied, because updateLabels replaces the array and a handed-out reference would go stale. */
	entities(): readonly Entity[] {
		return [...this.#nodes];
	}

	/**
	 * Replaces each label that is a key of `mappings` with its value; a `null` value drops the label instead.
	 *
	 * A mappings file mapping a label to the empty string reads as a deletion, settled in henrytill/hbt-go#73 and recorded in
	 * henrytill/hbt-hs#42. The empty string never reaches here -- `mkLabel` refuses it -- so the reader turns it into `null`.
	 *
	 * Substitutions are collected from the labels the node had, so mappings do not chain within a pass: with `a -> b` and
	 * `b -> c`, a label `a` becomes `b`, not `c`. Two labels mapped onto one name collapse, labels being a set.
	 */
	updateLabels(mappings: Iterable<readonly [Label, Label | null]>): void {
		const mapping = new Map(mappings);
		if (mapping.size === 0) {
			return;
		}
		this.#nodes = this.#nodes.map((node) => {
			let replaced = false;
			const labels = new Set<Label>();
			for (const label of node.labels) {
				if (!mapping.has(label)) {
					labels.add(label);
					continue;
				}
				const mapped = mapping.get(label);
				if (mapped != null) {
					labels.add(mapped);
				}
				replaced = true;
			}
			return replaced ? mkEntity({ ...node, labels }) : node;
		});
	}
}
