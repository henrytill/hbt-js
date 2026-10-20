import * as markdownIt from 'markdown-it';

import { Collection, type Id } from './collection.js';
import { type Label, ParseError, type Time, type Url, mkEntity, mkLabel, mkName, mkTime, mkUrl } from './entity.js';

/**
 * How deep markdown-it may nest blocks: a block quote is one level, a
 * nested list two (the list and its item).
 *
 * markdown-it's block parser recurses once per level, so it must stop
 * somewhere; unbounded, it overflows node's stack between 1000 and
 * 2000 levels. Its own limit, `maxNesting`, silently drops whatever
 * is deeper, so it is set out of reach and a rule of ours stops it
 * instead: `parseMarkdown` refuses a document that goes deeper than
 * this rather than returning part of one. The limit is well clear of
 * any bookmark file and below any engine's stack. hbt-rs has no
 * limit, which makes this the one depth at which the two differ.
 *
 * The inline parser recurses too, once per `[` it passes looking for
 * the `]` that ends a link's text, and stops at the same depth. There
 * it gives up on the link rather than refusing the document: the
 * brackets need never close, so a run of them seldom holds a link at
 * all. A link in or around a run nested this deep can be lost, which
 * hbt-rs reads, and that is the other place the two differ.
 */
const MAX_NESTING = 200;

/**
 * The parser, configured to read what hbt-rs's pulldown-cmark reads.
 *
 * The `commonmark` preset, since hbt-rs enables none of
 * pulldown-cmark's extensions: no tables, strikethrough or linkify,
 * and raw HTML parsed as HTML rather than taken as text. A link's
 * destination is left as written, backslash escapes and entities
 * aside, for `mkUrl` alone to normalize, as hbt-rs leaves it to
 * `Url::parse`: markdown-it's own normalization percent-encodes
 * characters such as `[` that the URL parser leaves alone, so it
 * would change the key.
 * Nor is any scheme refused, where markdown-it refuses `javascript:`
 * and three others by default: hbt-rs records such a link like any
 * other.
 */
const md = markdownIt.default('commonmark', { maxNesting: Infinity });
md.normalizeLink = (url) => url;
md.normalizeLinkText = (text) => text;
md.validateLink = () => true;

// markdown-it tries every block rule, in order, before reading a block
// at any level, so a rule ahead of the others sees each level the
// moment there is something to read at it, and refuses the document
// from `MAX_NESTING` on. It depends on no bound of `maxNesting`'s: a
// list opens with its first item, so the level can rise by two in one
// step, and a `maxNesting` one above the guard let that step land
// past it and drop the content unread (#22).
md.block.ruler.before('table', 'hbt_max_nesting', (state) => {
	if (state.level >= MAX_NESTING) {
		throw new ParseError(`nesting deeper than ${MAX_NESTING} levels`);
	}
	return false;
});

// The inline parser tries its rules the same way, one level deeper for
// each `[` it passes while it scans (`silent`) for the end of a link's
// text. Past the cap, a rule ahead of the others ends the scan where
// `maxNesting` would, at the end of the text, so the `[` it started
// from opens no link. Only a scan goes this deep, since a link cannot
// hold another; if anything else did, losing its text silently would
// be worse than refusing the document.
md.inline.ruler.before('text', 'hbt_max_nesting', (state, silent) => {
	if (state.level < MAX_NESTING) {
		return false;
	}
	if (!silent) {
		throw new ParseError(`nesting deeper than ${MAX_NESTING} levels`);
	}
	state.pos = state.posMax;
	return true;
});

/** Unicode's White_Space, which Rust's `char::is_whitespace` tests. */
const WS = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]*';

const MONTHS = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december',
];

/**
 * chrono's `%B %-d, %Y`, as hbt-rs parses it: a month's full name or
 * its first three letters, in any case; a day of one or two digits;
 * and a year of at most four digits, or of any length after a sign.
 * A space in the format matches any run of whitespace, none included.
 */
const MONTH = [...MONTHS, ...MONTHS.map((m) => m.slice(0, 3))].join('|');
const DATE = new RegExp(`^(${MONTH})${WS}(\\d{1,2}),${WS}([+-]\\d+|\\d{1,4})$`, 'i');

/** The years chrono's `NaiveDate` holds. */
const MIN_YEAR = -262143;
const MAX_YEAR = 262142;

/**
 * Parses an H1's text as a date, midnight UTC.
 *
 * Probed against hbt-rs: `Nov 5,2023`, `november  05, 2023` and
 * `November 5, +12023` parse there, and `November 5 2023`,
 * `Sept 5, 2023` and `February 29, 2023` do not.
 */
function parseDate(s: string): Time {
	const match = DATE.exec(s);
	if (match === null) {
		throw new ParseError(`date parsing error: ${s}`);
	}
	const month = MONTHS.findIndex((m) => m.startsWith(match[1]!.toLowerCase()));
	const day = Number(match[2]);
	const year = Number(match[3]);
	const date = new Date(0);
	// Not Date.UTC, which reads years 0 to 99 as 1900 to 1999.
	date.setUTCFullYear(year, month, day);
	if (year < MIN_YEAR || year > MAX_YEAR || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
		throw new ParseError(`date out of range: ${s}`);
	}
	return mkTime(date);
}

/**
 * Whether the link whose content is on top of `rest`, the walk's
 * stack, holds an inline link in an image's alt text.
 *
 * CommonMark forbids a link inside a link, so pulldown-cmark reads the
 * outer one's brackets as text. markdown-it enforces that only for a
 * link written directly in the text, and takes the outer one as a
 * link when the inner is in an image. An autolink does not count:
 * CommonMark lets a link hold one, and both parsers agree.
 */
function holdsLink(rest: readonly markdownIt.Token[]): boolean {
	const images: markdownIt.Token[] = [];
	let depth = 0;
	for (let i = rest.length - 1; i >= 0; i--) {
		const token = rest[i]!;
		if (token.type === 'link_open') {
			depth++;
		} else if (token.type === 'link_close') {
			if (depth === 0) {
				break;
			}
			depth--;
		} else if (token.type === 'image') {
			images.push(token);
		}
	}
	for (let image = images.pop(); image !== undefined; image = images.pop()) {
		for (const child of image.children ?? []) {
			if (child.type === 'link_open' && child.markup !== 'autolink') {
				return true;
			} else if (child.type === 'image') {
				images.push(child);
			}
		}
	}
	return false;
}

/**
 * What the construct most recently opened makes of a run of text: an
 * H1's is a date, a lower heading's a label, an inline link's part of
 * its name, and anything else's nothing.
 */
type Current = 'date' | 'label' | 'link' | 'other';

/**
 * Reads a Markdown document into a collection.
 *
 * An H1 is a date, and starts afresh: it clears the labels and the
 * nesting. An H2 and below is a label, which holds for every link
 * under it until a heading at its level or above replaces it. An
 * inline link or a URI autolink is a bookmark, created at the
 * enclosing date, with its text as its name; a link in a list nested
 * under another is joined to that one by an edge in each direction.
 *
 * This follows hbt-rs's `Collection::from_markdown` token for token,
 * and so inherits choices the corpus does not pin, where hbt-go's
 * goldmark walk differs:
 *
 * - The text that counts is what follows the most recent opening, so
 *   `[Hello *world* again](u)` is named `Hello `: the emphasis opened
 *   after the name began, and nothing closes back to the link.
 * - The parent of a nested list is the last link before it, wherever
 *   that link was: a bare link in the paragraph above a list parents
 *   its top-level items.
 * - A reference link or an email autolink is an error, `missing URL`,
 *   rather than a bookmark or plain text.
 * - Any other error, such as an unparseable date or URL, or a link
 *   before the first date, fails the whole document.
 *
 * It differs from hbt-rs in two places, both where markdown-it is
 * the one following CommonMark's letter, and a differential fuzz
 * against hbt-rs's binary found no third:
 *
 * - pulldown-cmark breaks a run of text at a backslash escape or an
 *   entity, and hbt-rs makes each piece of a heading its own label,
 *   so `## Foo\*bar` gives `Foo` and `*bar`. markdown-it joins the
 *   run first, giving the one label `Foo*bar`.
 * - markdown-it replaces U+0000 with U+FFFD, as the spec requires;
 *   hbt-rs keeps it.
 */
export function parseMarkdown(input: string): Collection {
	const collection = new Collection();

	let current: Current = 'other';
	let date: Time | undefined;
	let url: Url | undefined;
	let nameParts: string[] = [];
	let labels: Label[] = [];
	// The last bookmark made, which a list opened next nests under.
	let maybeParent: Id | undefined;
	let parents: Id[] = [];
	// Whether each link open is one that pulldown-cmark reads as text.
	const textLinks: boolean[] = [];

	const save = (): void => {
		if (url === undefined) {
			throw new ParseError('missing URL');
		}
		if (date === undefined) {
			throw new ParseError('missing date');
		}
		const name = nameParts.join('');
		const entity = mkEntity({
			url,
			createdAt: date,
			names: new Set(name === '' ? [] : [mkName(name)]),
			labels: new Set(labels),
		});
		url = undefined;
		nameParts = [];
		const id = collection.upsert(entity);
		const parent = parents.at(-1);
		if (parent !== undefined) {
			collection.addEdges(parent, id);
		}
		maybeParent = id;
	};

	const readText = (content: string): void => {
		if (current === 'date') {
			date = parseDate(content);
		} else if (current === 'label') {
			labels.push(mkLabel(content));
		} else if (current === 'link') {
			nameParts.push(content);
		}
	};

	// The tokens still to visit, the next on top. A token's children
	// follow it: an inline token holds the tokens of a paragraph or a
	// heading, and an image those of its alt text, which may hold images
	// in turn. Pushing each token's children as it is reached walks them
	// all in document order without recursion.
	const pending = md.parse(input, {}).reverse();
	for (let token = pending.pop(); token !== undefined; token = pending.pop()) {
		switch (token.type) {
			case 'heading_open': {
				const level = Number(token.tag.slice(1));
				if (level === 1) {
					date = undefined;
					labels = [];
					maybeParent = undefined;
					parents = [];
					current = 'date';
				} else {
					labels.length = Math.min(labels.length, level - 2);
					current = 'label';
				}
				break;
			}
			case 'bullet_list_open':
			case 'ordered_list_open':
				current = 'other';
				if (maybeParent !== undefined) {
					parents.push(maybeParent);
				}
				break;
			case 'bullet_list_close':
			case 'ordered_list_close':
				parents.pop();
				maybeParent = undefined;
				break;
			case 'link_open': {
				textLinks.push(holdsLink(pending));
				if (textLinks.at(-1)!) {
					// pulldown-cmark's text here is the `[` alone, which
					// hbt-rs takes as a label under a heading. What it
					// makes of the `](...)` at the close does not
					// matter: the inner link has opened since, so no
					// heading's text can follow.
					readText('[');
					break;
				}
				const href = String(token.attrGet('href') ?? '');
				current = 'other';
				// It may not be empty: `current` outlives the link that
				// set it, so text after one lands here too.
				nameParts = [];
				if (token.markup === 'autolink') {
					// An email autolink's destination gains a `mailto:`
					// that its text, the token after, lacks; hbt-rs
					// saves one with no URL. Comparing the two relies
					// on normalizeLink and normalizeLinkText both
					// leaving a URI autolink as written.
					if (pending.at(-1)?.content === href) {
						url = mkUrl(href);
					}
				} else if (token.meta?.['label'] === undefined) {
					// markdown-it gives only a reference link a label.
					url = mkUrl(href);
					current = 'link';
				}
				break;
			}
			case 'link_close':
				if (!textLinks.pop()) {
					save();
				}
				break;
			case 'text':
				// markdown-it leaves an empty text token beside an
				// emphasis delimiter; pulldown-cmark emits nothing
				// there, so `## **Foo**` is no label rather than an
				// empty one.
				if (token.content !== '') {
					readText(token.content);
				}
				break;
			case 'code_inline':
				if (current === 'link') {
					nameParts.push(`\`${token.content}\``);
				}
				break;
			case 'image':
				// pulldown-cmark opens an image as it does a link, so
				// the text after one is not the link's, and reports
				// the links in its alt text, its children here, like
				// any other, which hbt-rs records (#23). Nothing marks
				// its end here, and hbt-rs ignores pulldown-cmark's, so
				// what the alt text last opened still holds.
				current = 'other';
				break;
			default:
				if (token.nesting === 1) {
					current = 'other';
				}
		}
		const children = token.children ?? [];
		for (let i = children.length - 1; i >= 0; i--) {
			pending.push(children[i]!);
		}
	}

	return collection;
}
