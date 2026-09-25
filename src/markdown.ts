import * as markdownIt from 'markdown-it';

import { Collection, type Id } from './collection.js';
import { type Label, ParseError, type Time, type Url, mkEntity, mkLabel, mkName, mkTime, mkUrl } from './entity.js';

/**
 * How deep markdown-it may nest blocks: a block quote is one level, a
 * nested list two (the list and its item).
 *
 * markdown-it's block parser recurses once per level, so it must stop
 * somewhere; unbounded, it overflows node's stack between 1000 and
 * 2000 levels. At its limit it silently drops whatever is deeper, and
 * its `commonmark` preset's limit of 20 is only nine nested lists, so
 * this raises the limit well clear of any bookmark file and below any
 * engine's stack, and `parseMarkdown` refuses a document that reaches
 * it rather than returning part of one. hbt-rs has no limit, which
 * makes this the one depth at which the two differ.
 */
const MAX_NESTING = 200;

/**
 * The parser, configured to read what hbt-rs's pulldown-cmark reads.
 *
 * The `commonmark` preset, since hbt-rs enables none of
 * pulldown-cmark's extensions: no tables, strikethrough or linkify,
 * and raw HTML parsed as HTML rather than taken as text. A link's
 * destination is left as written, backslash escapes and entities
 * aside, for `mkUrl` to normalize as hbt-rs's `Url::parse` does:
 * markdown-it's own normalization percent-encodes characters such as
 * `[` that the URL parser leaves alone, so it would change the key.
 * Nor is any scheme refused, where markdown-it refuses `javascript:`
 * and three others by default: hbt-rs records such a link like any
 * other.
 */
const md = markdownIt.default('commonmark', { maxNesting: MAX_NESTING });
md.normalizeLink = (url) => url;
md.normalizeLinkText = (text) => text;
md.validateLink = () => true;

/** Unicode's White_Space, which Rust's `char::is_whitespace` tests. */
const WS = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]*';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * chrono's `%B %-d, %Y`, as hbt-rs parses it: a month's full name or
 * its first three letters, in any case; a day of one or two digits;
 * and a year of at most four digits, or of any length after a sign.
 * A space in the format matches any run of whitespace, none included.
 */
const DATE = new RegExp(
	'^(january|february|march|april|may|june|july|august|september|october|november|december|' +
		`${MONTHS.join('|')})${WS}(\\d{1,2}),${WS}([+-]\\d+|\\d{1,4})$`,
	'i',
);

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
	const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase());
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
 * The kind of the construct most recently opened, which is what
 * decides whether a run of text is a date, a label, part of a name,
 * or nothing.
 */
type Current = 'heading' | 'link' | 'other';

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
	let headingLevel = 1;
	let date: Time | undefined;
	let url: Url | undefined;
	let nameParts: string[] = [];
	let labels: Label[] = [];
	// The last bookmark made, which a list opened next nests under.
	let maybeParent: Id | undefined;
	let parents: Id[] = [];

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

	// Inline tokens hold their children in a flat array of their own,
	// so a pass over each level walks the document without recursion.
	for (const block of md.parse(input, {})) {
		const tokens: markdownIt.Token[] = block.type === 'inline' ? (block.children ?? []) : [block];
		for (const [i, token] of tokens.entries()) {
			// Whatever this opens may have lost its contents: at
			// MAX_NESTING - 1, a paragraph inside would be the level
			// markdown-it stops at. It is off by one only at the
			// boundary, refusing a block quote there whose one
			// paragraph did survive.
			if (token.nesting === 1 && token.level >= MAX_NESTING - 1) {
				throw new ParseError(`nesting deeper than ${MAX_NESTING} levels`);
			}
			switch (token.type) {
				case 'heading_open': {
					const level = Number(token.tag.slice(1));
					if (level === 1) {
						date = undefined;
						url = undefined;
						nameParts = [];
						labels = [];
						maybeParent = undefined;
						parents = [];
					} else {
						labels.length = Math.min(labels.length, level - 2);
					}
					headingLevel = level;
					current = 'heading';
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
					const href = String(token.attrGet('href') ?? '');
					current = 'other';
					if (token.markup === 'autolink') {
						// An email autolink's destination gains a `mailto:`
						// that its text, the token after, lacks; hbt-rs
						// saves one with no URL.
						if (tokens[i + 1]?.content === href) {
							url = mkUrl(href);
						}
						nameParts = [];
					} else if (token.meta?.label === undefined) {
						// markdown-it gives only a reference link a label.
						url = mkUrl(href);
						nameParts = [];
						current = 'link';
					}
					break;
				}
				case 'link_close':
					save();
					break;
				case 'text':
					// markdown-it leaves an empty text token beside an
					// emphasis delimiter; pulldown-cmark emits nothing
					// there, so `## **Foo**` is no label rather than an
					// empty one.
					if (token.content === '') {
						break;
					}
					if (current === 'heading') {
						if (headingLevel === 1) {
							date = parseDate(token.content);
						} else {
							labels.push(mkLabel(token.content));
						}
					} else if (current === 'link') {
						nameParts.push(token.content);
					}
					break;
				case 'code_inline':
					if (current === 'link') {
						nameParts.push(`\`${token.content}\``);
					}
					break;
				case 'image':
					// pulldown-cmark opens an image as it does a link, so
					// the text after one is not the link's.
					current = 'other';
					break;
				default:
					if (token.nesting === 1) {
						current = 'other';
					}
			}
		}
	}

	return collection;
}
