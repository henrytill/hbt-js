import { type Entity, type Label, type Url, mkEntity, entityMerge } from './entity.js';

/** A handle on one node, valid only for the collection that issued it. */
export interface Id {
	readonly index: number;
	readonly owner: object;
}

/** A graph of entities: nodes plus adjacency lists, with a URL index so one URL is one node. */
export class Collection {
	readonly #token = {};
	#nodes: Entity[] = [];
	#edges: number[][] = [];
	#urls = new Map<Url, number>();

	#makeId(index: number): Id {
		return { index, owner: this.#token };
	}

	#checkId(id: Id): void {
		if (id.owner !== this.#token) {
			throw new Error('Id belongs to a different collection');
		}
	}

	get length(): number {
		return this.#nodes.length;
	}

	get isEmpty(): boolean {
		return this.#nodes.length === 0;
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

	entities(): readonly Entity[] {
		return this.#nodes;
	}

	/** Replaces each label that is a key of `mappings` with its value. */
	updateLabels(mappings: Iterable<readonly [Label, Label]>): void {
		const mapping = new Map(mappings);
		this.#nodes = this.#nodes.map((node) => {
			const labels = new Set<Label>();
			for (const label of node.labels) {
				labels.add(mapping.get(label) ?? label);
			}
			return mkEntity({ ...node, labels });
		});
	}
}
