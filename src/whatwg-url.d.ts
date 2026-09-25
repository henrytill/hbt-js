// whatwg-url's parser module, which mkUrl imports directly (see there
// for why), carries no types of its own; @types/whatwg-url describes
// only the package's entry. This declares just what mkUrl uses.
declare module 'whatwg-url/lib/url-state-machine.js' {
	/** The spec's URL record, opaque here. */
	export interface URLRecord {
		readonly __brand: 'URLRecord';
	}

	/** https://url.spec.whatwg.org/#concept-url-parser */
	export function parseURL(input: string): URLRecord | null;

	/** https://url.spec.whatwg.org/#concept-url-serializer */
	export function serializeURL(url: URLRecord): string;
}
