// Stands in for `node:assert/strict` in the browser bundle (see
// build.mjs): the five assertions the unit tests use, with strict
// semantics. `deepEqual` covers what they compare - primitives,
// arrays, Sets, Maps, and objects by prototype and own enumerable
// properties, as Node does (so `#private` fields are not compared).
// It throws on any other built-in rather than guessing: a Date has no
// own properties, so the generic case would call any two equal.

export class AssertionError extends Error {
	override name = 'AssertionError';
}

function fail(message: string | undefined, fallback: string): never {
	throw new AssertionError(message ?? fallback);
}

export function ok(value: unknown, message?: string): asserts value {
	if (!value) fail(message, `expected a truthy value, got ${String(value)}`);
}

export function equal(actual: unknown, expected: unknown, message?: string): void {
	if (!Object.is(actual, expected)) fail(message, `expected ${String(expected)}, got ${String(actual)}`);
}

export function notEqual(actual: unknown, expected: unknown, message?: string): void {
	if (Object.is(actual, expected)) fail(message, `expected anything but ${String(expected)}`);
}

function isDeepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => isDeepEqual(x, b[i]));
	}
	// Set members are compared by identity, which suffices for the
	// primitives the tests put in them.
	if (a instanceof Set && b instanceof Set) {
		return a.size === b.size && a.isSubsetOf(b);
	}
	if (a instanceof Map && b instanceof Map) {
		return a.size === b.size && [...a].every(([k, v]) => b.has(k) && isDeepEqual(v, b.get(k)));
	}
	if (Object.prototype.toString.call(a) === '[object Object]') {
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every((k) => Object.hasOwn(b, k) && isDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
		);
	}
	throw new AssertionError(`deepEqual does not support ${Object.prototype.toString.call(a)}`);
}

export function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (!isDeepEqual(actual, expected)) fail(message, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function throws(fn: () => unknown, expected?: (new (...args: never[]) => Error) | RegExp, message?: string): void {
	try {
		fn();
	} catch (e) {
		if (expected === undefined) return;
		if (expected instanceof RegExp ? expected.test(String(e)) : e instanceof expected) return;
		fail(message, `threw the wrong error: ${String(e)}`);
	}
	fail(message, 'expected a throw');
}

export default { ok, equal, notEqual, deepEqual, throws, AssertionError };
