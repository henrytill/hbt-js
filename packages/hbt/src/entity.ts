import * as whatwgUrl from 'whatwg-url/lib/url-state-machine.js';

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * A URL in its WHATWG-normalized form, so two spellings of one
 * address are the same key.
 */
export type Url = Brand<string, 'Url'>;

/** A title a source gave the bookmark, such as a link's text. */
export type Name = Brand<string, 'Name'>;

/** A tag. */
export type Label = Brand<string, 'Label'>;

/**
 * A longer description: Pinboard's `extended`, or the `<DD>` after an
 * HTML anchor.
 */
export type Extended = Brand<string, 'Extended'>;

/** Whole seconds since the Unix epoch: the form on the wire. */
export type Time = Brand<number, 'Time'>;

/** Thrown when input cannot be made into one of these types. */
export class ParseError extends Error {
	override readonly name = 'ParseError';
}

/**
 * Parses a URL into its normalized form, throwing a `ParseError` if
 * it is not one.
 *
 * This uses whatwg-url, the spec's reference implementation, rather
 * than the platform's `URL`, because the platforms disagree and the
 * result is the collection's key. Chromium 141 percent-encodes `|` in
 * a path and `'` in userinfo, and accepts hosts such as `a b.com`
 * that the spec rejects; node's result moves with its ada version
 * (node 22 leaves `^` in a path, node 24 encodes it). One parser
 * everywhere gives one key everywhere.
 *
 * It imports the parser module directly, not the package's entry,
 * which also loads the `URL` class's WebIDL wrapper: that reads
 * `SharedArrayBuffer.prototype` at load time, and a browser page that
 * is not cross-origin isolated has no `SharedArrayBuffer`, so the
 * import throws (jsdom/webidl-conversions#31, still open). The module
 * is not public API, so `src/whatwg-url.d.ts` declares what is used
 * and the unit tests are what catch a move. It stays on whatwg-url 15:
 * from 16 the parser pulls in @exodus/bytes' legacy encoding tables,
 * which more than double the browser bundle.
 *
 * The form is the current spec's, which is not quite hbt-rs's: its
 * `url` crate (2.5.8) still leaves `^` in a path raw, leaves a space
 * before `?` or `#` in an opaque path raw, and keeps a `|` drive
 * letter in a `file:` URL.
 */
export function mkUrl(s: string): Url {
	const url = whatwgUrl.parseURL(s);
	if (url === null) {
		throw new ParseError(`URL parsing error: ${s}`);
	}
	return whatwgUrl.serializeURL(url) as Url;
}

/**
 * Refuses the empty string.
 *
 * An empty name, label or description is a value the formatters write
 * and the readers drop, so a collection carrying one does not
 * round-trip. Enforcing it here rather than at each parse site means
 * no producer can make one -- see hbt-ocaml's `Entity.Empty`, which
 * refuses it on the same ground.
 */
function nonEmpty<B extends string>(s: string, what: string): Brand<string, B> {
	if (s === '') {
		throw new ParseError(`${what} must not be empty`);
	}
	return s as Brand<string, B>;
}

/** Wraps a name, refusing the empty string. */
export const mkName = (s: string): Name => nonEmpty<'Name'>(s, 'name');

/** Wraps a label, refusing the empty string. */
export const mkLabel = (s: string): Label => nonEmpty<'Label'>(s, 'label');

/** Wraps a description, refusing the empty string. */
export const mkExtended = (s: string): Extended => nonEmpty<'Extended'>(s, 'extended');

/**
 * The widest instant this can hold, in whole seconds: the ECMAScript
 * limit on a Date, +/-8.64e15 ms.
 *
 * Number.isSafeInteger alone admits about 285 million years, where
 * hbt-rs rejects anything chrono's DateTime cannot hold
 * (`parse_timestamp` fails on a timestamp `DateTime::from_timestamp`
 * refuses), so a nonsense ADD_DATE that errors there would have been
 * accepted here and then differed in the output instead. The two
 * bounds are close but not identical -- chrono stops a little sooner
 * -- so a value between them is still a divergence, and no fixture
 * pins one.
 */
const MAX_TIME = 8_640_000_000_000;

/**
 * Wraps a Unix timestamp, floored to whole seconds so the value in
 * memory is the one on the wire.
 *
 * Floored, not truncated: a pre-epoch fraction has to go to the
 * second below, which is what serializing it gives back. hbt-rs pins
 * this (`parse_flexible_truncates_pre_epoch_sub_second_precision`
 * asserts `1969-12-31T23:59:59.500Z` is `-1`), and a Pinboard `time`
 * is RFC 3339 and may carry a fraction, so truncating toward zero
 * would disagree by a second on every pre-epoch post.
 */
export function mkTime(seconds: number): Time;
export function mkTime(date: Date): Time;
export function mkTime(value: number | Date): Time {
	const seconds = value instanceof Date ? value.getTime() / 1000 : value;
	const floored = Math.floor(seconds);
	if (!Number.isInteger(floored) || Math.abs(floored) > MAX_TIME) {
		throw new ParseError(`timestamp out of range: ${seconds}`);
	}
	return floored as Time;
}

/**
 * A bookmark, in normal form.
 *
 * `mkEntity` is the only thing here that builds one, and it is what
 * holds the normal form: an update never repeats `createdAt`, since
 * it would carry no information `createdAt` does not. An update
 * strictly below `createdAt` is a different thing and stays.
 */
export type Entity = {
	/** The key: two entities with one URL are one bookmark. */
	readonly url: Url;
	/**
	 * Absent for an undated mention: an absent time is the identity
	 * of a merge, not a very old instant.
	 */
	readonly createdAt?: Time;
	/** Updates, never including `createdAt`. */
	readonly updatedAt: ReadonlySet<Time>;
	/** Every title the sources gave, since a merge keeps them all. */
	readonly names: ReadonlySet<Name>;
	/**
	 * Tags: Pinboard's `tags`, an HTML anchor's `TAGS` and enclosing
	 * folders, or the headings above a Markdown link.
	 */
	readonly labels: ReadonlySet<Label>;
	/**
	 * Whether the bookmark is public: Pinboard's `shared`, or the
	 * inverse of an HTML anchor's `PRIVATE`.
	 */
	readonly shared?: boolean;
	/** Pinboard's `toread`, or an HTML anchor's `TOREAD`. */
	readonly toRead?: boolean;
	/** An HTML anchor's `FEED`. */
	readonly isFeed?: boolean;
	/** Every longer description the sources gave. */
	readonly extended: ReadonlySet<Extended>;
	/** An HTML anchor's `LAST_VISIT`. */
	readonly lastVisitedAt?: Time;
};

/** What `mkEntity` takes: an entity with every field but `url`
    optional. */
export type EntityInit = Partial<Omit<Entity, 'url'>> & { readonly url: Url };

/**
 * Builds an entity in normal form.
 *
 * Every construction goes through here, so the one rule of the normal
 * form -- an update never repeats `createdAt`, since it would carry
 * no information `createdAt` does not -- holds by construction. An
 * update strictly below `createdAt` is a different thing and stays.
 */
export function mkEntity(init: EntityInit): Entity {
	// The other implementations guarantee the normal form at runtime
	// rather than in the type -- hbt-rs with a
	// `debug_assert!(self.is_normal())` on serialize, hbt-go with a
	// `Normalize()` call at the parse and decode boundaries -- and
	// this should grow the same check at the serialize and decode
	// boundaries when they land.
	const updatedAt = new Set(init.updatedAt);
	if (init.createdAt !== undefined) {
		updatedAt.delete(init.createdAt);
	}
	return {
		...init,
		updatedAt,
		names: new Set(init.names),
		labels: new Set(init.labels),
		extended: new Set(init.extended),
	};
}

const setEquals = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean => a.size === b.size && a.isSubsetOf(b);

/**
 * Returns whether two entities agree on every field, comparing sets
 * by membership.
 */
export function entityEquals(a: Entity, b: Entity): boolean {
	return (
		a.url === b.url &&
		a.createdAt === b.createdAt &&
		a.shared === b.shared &&
		a.toRead === b.toRead &&
		a.isFeed === b.isFeed &&
		a.lastVisitedAt === b.lastVisitedAt &&
		setEquals(a.updatedAt, b.updatedAt) &&
		setEquals(a.names, b.names) &&
		setEquals(a.labels, b.labels) &&
		setEquals(a.extended, b.extended)
	);
}

/**
 * Combines two optional values; an absent one contributes nothing.
 */
function combine<T>(a: T | undefined, b: T | undefined, f: (a: T, b: T) => T): T | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return f(a, b);
}

/**
 * Absorbs `other` into `entity`, returning the result.
 *
 * Merging is field-wise. The earlier creation time wins; both
 * creation times go into the update history and `mkEntity` takes the
 * winner back out, which is what keeps merging associative. Merging
 * an entity that already equals `entity` is a no-op. Flags combine
 * with `||`; `lastVisitedAt` keeps the most recent time.
 */
export function entityMerge(entity: Entity, other: Entity): Entity {
	if (entityEquals(entity, other)) {
		return entity;
	}
	const updatedAt = entity.updatedAt.union(other.updatedAt);
	if (entity.createdAt !== undefined) updatedAt.add(entity.createdAt);
	if (other.createdAt !== undefined) updatedAt.add(other.createdAt);
	const createdAt = combine(entity.createdAt, other.createdAt, (a, b) => (a < b ? a : b));
	const shared = combine(entity.shared, other.shared, (a, b) => a || b);
	const toRead = combine(entity.toRead, other.toRead, (a, b) => a || b);
	const isFeed = combine(entity.isFeed, other.isFeed, (a, b) => a || b);
	const lastVisitedAt = combine(entity.lastVisitedAt, other.lastVisitedAt, (a, b) => (a > b ? a : b));
	return mkEntity({
		url: entity.url,
		updatedAt,
		names: entity.names.union(other.names),
		labels: entity.labels.union(other.labels),
		extended: entity.extended.union(other.extended),
		...(createdAt !== undefined && { createdAt }),
		...(shared !== undefined && { shared }),
		...(toRead !== undefined && { toRead }),
		...(isFeed !== undefined && { isFeed }),
		...(lastVisitedAt !== undefined && { lastVisitedAt }),
	});
}
