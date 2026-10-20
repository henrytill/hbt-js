// Helpers the library's modules share but does not publish: index.ts
// re-exports every other module as a namespace, and not this one, so
// nothing here becomes part of the package's API.

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
export function compareCodePoints(a: string, b: string): number {
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
