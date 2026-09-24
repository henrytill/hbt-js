import * as yaml from 'yaml';

import type { Collection } from './collection.js';
import type { Entity } from './entity.js';

/** The serialization format's version, which a reader checks against `^0.1.0`. */
const VERSION = '0.1.0';

/**
 * Orders strings by code point, as hbt-rs's `BTreeSet<String>` and
 * hbt-go's `slices.Sort` do by comparing UTF-8 bytes. The default
 * `<` compares UTF-16 code units, which puts an astral character
 * (a surrogate pair, from U+D800) before U+E000-U+FFFF.
 */
function compareCodePoints(a: string, b: string): number {
	const as = a[Symbol.iterator]();
	const bs = b[Symbol.iterator]();
	for (;;) {
		const x = as.next();
		const y = bs.next();
		if (x.done || y.done) return (x.done ? 0 : 1) - (y.done ? 0 : 1);
		const d = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
		if (d !== 0) return d;
	}
}

const sortedStrings = (s: ReadonlySet<string>): string[] => [...s].sort(compareCodePoints);

/**
 * An entity as `collection.schema.json` spells it: `url` is `uri`,
 * the sets are sorted lists, and an absent field is left out, as
 * hbt-rs leaves it out. The keys are in hbt-rs's order, which the
 * harness ignores but a reader diffing two outputs does not.
 */
function entityRepr(entity: Entity): Record<string, unknown> {
	return {
		uri: entity.url,
		...(entity.createdAt !== undefined && { createdAt: entity.createdAt }),
		updatedAt: [...entity.updatedAt].sort((a, b) => a - b),
		names: sortedStrings(entity.names),
		labels: sortedStrings(entity.labels),
		...(entity.shared !== undefined && { shared: entity.shared }),
		...(entity.toRead !== undefined && { toRead: entity.toRead }),
		...(entity.isFeed !== undefined && { isFeed: entity.isFeed }),
		...(entity.extended.size > 0 && { extended: sortedStrings(entity.extended) }),
		...(entity.lastVisitedAt !== undefined && { lastVisitedAt: entity.lastVisitedAt }),
	};
}

/**
 * PyYAML resolves these two plain scalars to the merge and value keys
 * wherever they appear, and its safe loader then refuses them, so a
 * name or label spelled exactly so has to be quoted.
 */
const PYYAML_KEYS: ReadonlySet<unknown> = new Set(['<<', '=']);

/**
 * The `yaml` package's 1.1 schema, less its merge key tag, which
 * claims the string `<<` and writes it plain whatever the node's
 * type says. The `merge: false` option does not remove it.
 */
const withoutMerge = (tags: yaml.Tags): yaml.Tags => tags.filter((tag) => typeof tag === 'string' || tag.tag !== 'tag:yaml.org,2002:merge');

/**
 * Writes `collection` as YAML, in the shape `collection.schema.json`
 * describes. Edges keep the order they were added in.
 *
 * Written as YAML 1.1, which quotes a string such as `yes`, `off` or
 * `2024-01-01` that 1.2 leaves plain: the conformance harness reads
 * with PyYAML, a 1.1 loader, and would take those as a boolean or a
 * date.
 */
export function formatYaml(collection: Collection): string {
	const value = collection.ids().map((id) => ({
		id: id.index,
		entity: entityRepr(collection.entity(id)),
		edges: collection.edges(id).map((to) => to.index),
	}));
	const doc = new yaml.Document({ version: VERSION, length: collection.length, value }, { version: '1.1', customTags: withoutMerge });
	yaml.visit(doc, {
		Scalar(_, node) {
			if (PYYAML_KEYS.has(node.value)) node.type = yaml.Scalar.QUOTE_DOUBLE;
		},
	});
	return doc.toString({ lineWidth: 0, indentSeq: false });
}
