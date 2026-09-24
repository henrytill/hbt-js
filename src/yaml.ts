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
 *
 * Code-unit and code-point order differ only there, so the first
 * differing pair of units is compared with the surrogates moved above
 * U+FFFF, the fixup ICU's `u_strCompare` uses in code-point order.
 */
function compareCodePoints(a: string, b: string): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		let x = a.charCodeAt(i);
		let y = b.charCodeAt(i);
		if (x === y) continue;
		if (x >= 0xd800 && y >= 0xd800) {
			x += x >= 0xe000 ? -0x800 : 0x2000;
			y += y >= 0xe000 ? -0x800 : 0x2000;
		}
		return x - y;
	}
	return a.length - b.length;
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
 * The `yaml` package's 1.1 schema, less its merge key tag, which
 * claims the string `<<` and writes it plain whatever else the
 * options say. The `merge: false` option does not remove it.
 */
const withoutMerge = (tags: yaml.Tags): yaml.Tags => tags.filter((tag) => typeof tag === 'string' || tag.tag !== 'tag:yaml.org,2002:merge');

const pyyamlKey = (tag: string, test: RegExp): yaml.ScalarTag => ({ tag, default: true, test, resolve: (s) => s });

/**
 * The two implicit keys of PyYAML's resolver that the package's 1.1
 * schema does not know: the merge key `<<` and the value key `=`.
 * PyYAML resolves either one wherever it appears plain, and its safe
 * loader then refuses it, so a name or label spelled exactly so has to
 * be quoted -- which `compat` does for any string one of these tags
 * would claim. Every other resolver of PyYAML's agrees with the 1.1
 * schema: a fuzz of strings built from its grammar found no other
 * plain scalar it reads as anything but a string.
 */
const PYYAML_KEYS = [pyyamlKey('tag:yaml.org,2002:merge', /^<<$/), pyyamlKey('tag:yaml.org,2002:value', /^=$/)];

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
	return yaml.stringify({ version: VERSION, length: collection.length, value }, {
		version: '1.1',
		customTags: withoutMerge,
		compat: PYYAML_KEYS,
		lineWidth: 0,
		indentSeq: false,
	});
}
