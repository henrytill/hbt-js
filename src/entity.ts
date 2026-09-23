declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * A URL in its WHATWG-normalized form, so two spellings of one
 * address are the same key.
 */
export type Url = Brand<string, 'Url'>;
export type Name = Brand<string, 'Name'>;
export type Label = Brand<string, 'Label'>;
export type Extended = Brand<string, 'Extended'>;
/** Whole seconds since the Unix epoch: the form on the wire. */
export type Time = Brand<number, 'Time'>;

export class ParseError extends Error {
	override readonly name = 'ParseError';
}

export function mkUrl(s: string): Url {
	const url = URL.parse(s);
	if (url === null) {
		throw new ParseError(`URL parsing error: ${s}`);
	}
	return url.href as Url;
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

export const mkName = (s: string): Name => nonEmpty<'Name'>(s, 'name');
export const mkLabel = (s: string): Label => nonEmpty<'Label'>(s, 'label');
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
	readonly url: Url;
	/**
	 * Absent for an undated mention: an absent time is the identity
	 * of a merge, not a very old instant.
	 */
	readonly createdAt?: Time;
	/** Updates, never including `createdAt`. */
	readonly updatedAt: ReadonlySet<Time>;
	readonly names: ReadonlySet<Name>;
	readonly labels: ReadonlySet<Label>;
	readonly shared?: boolean;
	readonly toRead?: boolean;
	readonly isFeed?: boolean;
	readonly extended: ReadonlySet<Extended>;
	readonly lastVisitedAt?: Time;
};

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
