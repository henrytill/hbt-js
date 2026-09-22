declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A URL in its WHATWG-normalized form, so two spellings of one address are the same key. */
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

export const mkName = (s: string): Name => s as Name;
export const mkLabel = (s: string): Label => s as Label;
export const mkExtended = (s: string): Extended => s as Extended;

/** Wraps a Unix timestamp, truncated to whole seconds so the value in memory is the one on the wire. */
export function mkTime(seconds: number): Time;
export function mkTime(date: Date): Time;
export function mkTime(value: number | Date): Time {
	const seconds = value instanceof Date ? value.getTime() / 1000 : value;
	const truncated = Math.trunc(seconds);
	if (!Number.isSafeInteger(truncated)) {
		throw new ParseError(`timestamp out of range: ${seconds}`);
	}
	return truncated as Time;
}

export interface Entity {
	readonly url: Url;
	/** Absent for an undated mention: an absent time is the identity of a merge, not a very old instant. */
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
}

export type EntityInit = Partial<Omit<Entity, 'url'>> & { readonly url: Url };

/**
 * Builds an entity in normal form.
 *
 * Every construction goes through here, so the one rule of the normal form -- an update never repeats `createdAt`, since it
 * would carry no information `createdAt` does not -- holds by construction. An update strictly below `createdAt` is a different
 * thing and stays.
 */
export function mkEntity(init: EntityInit): Entity {
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

const setUnion = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> => new Set([...a, ...b]);

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

/** Combines two optional values; an absent one contributes nothing. */
function combine<T>(a: T | undefined, b: T | undefined, f: (a: T, b: T) => T): T | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return f(a, b);
}

/**
 * Absorbs `other` into `entity`, returning the result.
 *
 * Merging is field-wise. The earlier creation time wins; both creation times go into the update history and `create` takes the
 * winner back out, which is what keeps merging associative. Merging an entity that already equals `entity` is a no-op.
 * Flags combine with `||`; `lastVisitedAt` keeps the most recent time.
 */
export function entityMerge(entity: Entity, other: Entity): Entity {
	if (entityEquals(entity, other)) {
		return entity;
	}
	const updatedAt = setUnion(entity.updatedAt, other.updatedAt);
	for (const t of [entity.createdAt, other.createdAt]) {
		if (t !== undefined) updatedAt.add(t);
	}
	const merged: {
		-readonly [K in keyof Entity]: Entity[K];
	} = {
		url: entity.url,
		updatedAt,
		names: setUnion(entity.names, other.names),
		labels: setUnion(entity.labels, other.labels),
		extended: setUnion(entity.extended, other.extended),
	};
	const optional = {
		createdAt: combine(entity.createdAt, other.createdAt, Math.min) as Time | undefined,
		shared: combine(entity.shared, other.shared, (a, b) => a || b),
		toRead: combine(entity.toRead, other.toRead, (a, b) => a || b),
		isFeed: combine(entity.isFeed, other.isFeed, (a, b) => a || b),
		lastVisitedAt: combine(entity.lastVisitedAt, other.lastVisitedAt, Math.max) as Time | undefined,
	};
	for (const [key, value] of Object.entries(optional)) {
		if (value !== undefined) Object.assign(merged, { [key]: value });
	}
	return mkEntity(merged);
}
