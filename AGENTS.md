# hbt-js

## REMEMBER

**Use GitHub MCP for all GitHub queries** (instead of fetching webpages)

**Never work directly on `master`** - branch first, land via PR (see [Git Workflow](#git-workflow))

**Run `npm run fmt` before every commit** - dprint is not a CI check, so a misformatted file lands silently and churns the next diff

**Every fixture without a parser is waived** - the Markdown fixtures pass; the HTML and Pinboard ones report `xfail` until their parsers land (see [Testing](#testing))

**Fixtures live in a submodule shared with four other implementations** - changing one is a cross-language decision (see [Testing](#testing))

## Overview

A TypeScript implementation of hbt, a bookmark and document collection tool, developed differentially alongside:

- [hbt-rs](https://github.com/henrytill/hbt-rs) (Rust)
- [hbt-go](https://github.com/henrytill/hbt-go) (Go)
- [hbt-ocaml](https://github.com/henrytill/hbt-ocaml) (OCaml)
- [hbt-hs](https://github.com/henrytill/hbt-hs) (Haskell)

The tool reads bookmarks from Pinboard exports (JSON/XML), Netscape bookmark HTML, and Markdown, merges them into a collection keyed by URL, and writes the result as YAML or HTML.

**This is the newest and least finished of the five.** The data model - `Entity`, `Collection`, and the merge - is written and tested, and so are the YAML formatter, the Markdown parser and the CLI. Nothing else is: there are no other parsers and no HTML formatter, so `hbt` reads only Markdown and writes only YAML, and refuses the rest with an error. Read any statement about parsers or formats below as describing what the other four do and what this one is being built toward.

The implementations share a wire format and a fixture corpus, so a semantic question - what merging two entities that share a timestamp should produce, say - gets settled once and pinned in [hbt-data](https://github.com/henrytill/hbt-data), then implemented in each. Issues are filed as companions across the repos; the discussion usually lives in whichever one hit it first. **hbt-rs's `AGENTS.md` carries the long form of the merge rules**, each with the issue that settled it; this file states what the code here does and does not restate the arguments.

## Plan

The order the rest is expected to land in, each step its own PR. It is provisional, not settled: revise it here when it changes, and mark a step done when it merges.

1. **Markdown parser**, on [markdown-it](https://github.com/markdown-it/markdown-it) rather than the [commonmark.js](https://github.com/commonmark/commonmark.js) first planned. **Done**: `src/markdown.ts`, which passes all 25 fixtures.
2. **CLI** in `cli/cli.ts`: arguments, file reading and `--version`, kept out of the library. **Done**, with hbt-rs's flags and messages (see [below](#clits)).
3. **The library and the CLI as npm workspace packages** (henrytill/hbt-js#32), so that a dependency only the CLI uses - the DOM implementation it will supply from Pinboard XML on - is not installed by every library consumer. `src/` and `cli/` already map onto the two packages; settle first how nixpkgs' `importNpmLock` and `linkNodeModulesHook` handle a workspace.
4. **Pinboard JSON, then Pinboard XML, then Netscape HTML.** Remove waivers as fixtures pass, as [Testing](#testing) describes.

The HTML and XML parsers are written against the DOM API and take a `DOMParser` (see Core Principles). Which one the CLI supplies is open: [linkedom](https://github.com/WebReflection/linkedom) (lean) or [jsdom](https://github.com/jsdom/jsdom) (fidelity), chosen by running both against the fixtures. Netscape bookmark HTML is not well-formed XML (unclosed `<DT>` and `<p>`), so it needs a real HTML parser, and its fixtures are where the two are likeliest to differ from each other and from a browser. If injection proves awkward, the fallback is [parse5](https://github.com/inikulin/parse5) and [@xmldom/xmldom](https://github.com/xmldom/xmldom) imported by the library directly, which behave the same everywhere.

## Core Principles

- **Typecheck early & often**: types are not only a correctness check, they guide the design. `tsconfig.base.json`, which every project extends, takes its checks from [`@tsconfig/strictest`](https://github.com/tsconfig/bases) - `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` (so an index signature is read as `env['NAME']`, not `env.NAME`), no unused locals or parameters, and the rest - and adds `verbatimModuleSyntax`. Keep them on; `exactOptionalPropertyTypes` in particular is what makes "absent" and "present and `undefined`" different things, which the optional timestamps depend on.
- **Branded types over bare primitives**: `Url`, `Name`, `Label`, `Extended` and `Time` are all `Brand<...>` aliases over `string` or `number`, so the checker catches field mix-ups the way hbt-rs's newtypes and hbt-go's named types do. Follow the pattern when adding a field. The brand is a `declare const brand: unique symbol`, so it exists only at the type level and costs nothing at runtime.
- **Make illegal states unrepresentable**: where TypeScript cannot, constrain construction to one place. `mkEntity` is the only thing that builds an `Entity`; `mkName`, `mkLabel` and `mkExtended` are the only things that build their brands, and each refuses the empty string.
- **The library runs in a browser too**: hbt-js starts as a CLI but is meant to run in a browser as well, so everything but `cli/` and the scripts stays free of Node APIs (`fs`, `process`, `path`, `Buffer`). The library takes and returns strings; reading files, parsing arguments and choosing a format from an extension belong to the CLI. A parser that needs a platform facility, such as a `DOMParser` for HTML and XML, takes it as an argument, so the browser passes its own and the CLI supplies one.
  - **`tsc -b` enforces it, with one directory and one project per environment** (henrytill/hbt-js#27). `tsconfig.json` is a solution file that only references them, and every one extends `tsconfig.base.json`, which is plain ECMAScript - ES2025, `types: []`, no `DOM`. Three keep that environment: `src/` (the library), `test/unit/` (its unit tests, typed against the stand-ins; see [Testing](#testing)) and `test/browser/` (the stand-ins, with the few DOM globals they use declared by hand). `cli/` (the CLI), `test/cli/` (its test) and `tsconfig.scripts.json` at the root (the `.mjs` scripts beside it) extend `@tsconfig/node24` after the base, which overrides the environment with Node 24's and leaves the rest. No `@tsconfig` package describes plain ECMAScript - `recommended` is ES2016 and CommonJS - so the base spells the environment out, over `strictest`, which sets checks alone. So `process`, `Buffer`, `document` or an import of `node:fs` in `src/` fails the build, while the same line in `cli/` passes; esbuild's browser bundle alone would have caught only the import. Adding `DOM` to the library's `lib` would undo this, not help: an injected facility is instead a small interface the library declares, the way `test/browser/test.ts` declares `document`, which the native `DOMParser` and the CLI's alike satisfy. **Where a file goes decides what it may use**: a module that needs Node goes in `cli/`, never `src/`. **The configs in `src/` and `cli/` set `tsBuildInfoFile`**, since `tsc -b` would otherwise write it beside their outputs in `dist/tsc/src/` and `dist/tsc/cli/`, which are published; a project added in either needs the same.
- **No recursion**: avoid recursive calls over user-provided data, which can nest arbitrarily deeply. The parsers in the other four all walk an explicit stack; the ones here should too when they land. A dependency counts: markdown-it's block parser recurses once per level of nesting, so `src/markdown.ts` bounds it and refuses a document past the bound (see [below](#markdownts)).

## Layout

A single npm package, ESM (`"type": "module"`), built from `src/` and `cli/` to `dist/` twice over: `tsc -b` builds the projects in [Core Principles](#core-principles) and writes everything that runs under node - the library and the CLI - unbundled, as the `prebuild` script, and `build.mjs` then uses esbuild to write the browser bundles.

| File                            | Role                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/entity.ts`                 | The branded types, `Entity`, `mkEntity`, `entityEquals`, `entityMerge`, `ParseError`                                         |
| `src/whatwg-url.d.ts`           | Types for the one whatwg-url module `mkUrl` imports, which ships none                                                        |
| `src/collection.ts`             | `Id` and `Collection` - the graph, the URL index, `upsert`, `updateLabels`                                                   |
| `src/order.ts`                  | `compareCodePoints`, shared by the modules but not re-exported, so not part of the package's API                             |
| `src/yaml.ts`                   | `formatYaml` - a `Collection` as `collection.schema.json` describes it                                                       |
| `src/markdown.ts`               | `parseMarkdown` - a Markdown document as a `Collection`                                                                      |
| `src/index.ts`                  | The library's entry point: re-exports each module above as a namespace (`entity`, `collection`, `yaml`, `markdown`)          |
| `cli/cli.ts`                    | The CLI entry point, and the only module in the package that may use Node APIs                                               |
| `tsconfig*.json`                | The solution file, the shared base, and the scripts' project; each other project sits in its directory (see Core Principles) |
| `test/unit/`                    | Unit tests of the library                                                                                                    |
| `test/cli/`                     | The CLI's test, which spawns the built CLI                                                                                   |
| `test/browser/`                 | Stand-ins for `node:test` and `node:assert/strict`, and the test page                                                        |
| `build.mjs`, `test-browser.mjs` | The `build` and `test:browser` scripts: the browser bundles, and running the test page in headless Chromium                  |
| `test/data/`                    | The [hbt-data](https://github.com/henrytill/hbt-data) submodule: corpus, conformance harness, flake                          |

- `dist/tsc/src/` - the library from `tsc`: one `.js`, `.d.ts` and source map per module, and what `package.json`'s `exports` names, so consumers can import only `hbt` itself. **`exports` names the `.js` alone, with no `types` condition**: TypeScript finds the `.d.ts` beside it, and a `types` condition only works ahead of `default`, an order nixpkgs' `buildNodeModules` loses - it rewrites `package.json` for the dev shell's linked `node_modules` with Nix's `toJSON`, which sorts keys, and esbuild, reading that copy, warns that `types` will never be used. It is unbundled, so its third-party imports stay imports: **a dependency the library uses is a `dependency`**, which the consumer installs along with its types, and the consumer's bundler picks that package's browser or node build. The extra `src/` is there because every project shares one `rootDir`, the repository, and one `outDir`, so `dist/tsc/` mirrors the source tree: the tests' outputs land in `dist/tsc/test/`, outside `files`, and nothing published needs leaving out.
- `dist/tsc/*.tsbuildinfo` - one per project, `tsc -b`'s record of what it built; outside `files`. **`dist/` belongs to the build: reset it with `npm run clean`, which deletes all of it, never by deleting files inside it.** `tsc -b` trusts its record without checking that the outputs it lists still exist, so a hand-deleted `.js` is not rebuilt and its dependents fail with `TS6305`. Nor does any build remove the outputs of a source that is gone (`tsc -b --clean` included), so a deleted or renamed `*.test.ts` leaves a compiled copy that `npm test`'s glob keeps running.
- `dist/tsc/cli/cli.js` - the CLI, from `tsc` too, and what `bin` names; `exports` does not, so consumers cannot import it. Unbundled, it runs the same modules consumers get, so conformance tests the shipped library. The cost is that **a dependency only the CLI uses is still a `dependency`**, installed by every consumer: prefer a light one, or load a heavy one with a dynamic `import()`, until the workspace split (Plan step 3) gives the CLI a package of its own.
- `dist/browser/hbt.js` - the library, bundled by esbuild for the browser. Nothing consumes it yet, and `files` leaves it out of the package: a browser app that installs `hbt` bundles `dist/tsc/`, and the only consumer the tarball copy would reach is a CDN. It is built so that a dependency reaching for a Node builtin fails the build (`Could not resolve "fs"`) the day it is added, not the day a browser front end is. If a CDN use case appears, publish it with an `exports` subpath (`"./browser"`) so it is a supported entry rather than a stray file. **Choose library dependencies that bundle for both platforms.**
- `dist/test/browser/` - every test file in one esbuild script, beside the page that loads it. Not published.

`dist/tsc/` is named for how it is built, not where it runs: a browser app that installs `hbt` and bundles it gets `dist/tsc/src/index.js` too, not `dist/browser/`, which is for loading directly with `<script type="module">`. Its third-party imports resolve by whoever loads it - node takes each dependency's `node` export condition, a browser bundler the `browser` one - so the browser and node may run different builds of the same dependency.

### `entity.ts`

`Entity` is a `type`, not a class: a readonly record whose multi-valued fields (`updatedAt`, `names`, `labels`, `extended`) are `ReadonlySet` and whose optional ones (`createdAt`, `shared`, `toRead`, `isFeed`, `lastVisitedAt`) are absent rather than null when unset.

- **`mkEntity` holds the normal form.** An update never repeats `createdAt`; an update strictly _below_ `createdAt` is a different thing and stays. Every construction goes through it, so the rule holds by construction rather than by a normalizing pass. hbt-rs asserts it on serialize and hbt-go calls `Normalize()` at the parse and decode boundaries - **this should grow the same check at the serialize and decode boundaries when they land**, since a decoded collection is input like any other.
- **`mkUrl` parses with whatwg-url's `lib/url-state-machine.js`, not the platform's `URL` or the package entry**; the comment says why. That module is not public API and whatwg-url is held at 15, so run `npm run test:browser` after any bump. The form is the current spec's, which differs from hbt-rs's in a few places the comment lists; no fixture pins either yet. It is also about 85x slower per call than the platform's `URL`, mostly percent-encoding every code point through a `TextEncoder`. Known: #21.
- **`mkTime` floors, and bounds.** Floored rather than truncated toward zero, so a pre-epoch fraction goes to the second below and agrees with what serializing gives back; the comment names the hbt-rs test that pins it. `MAX_TIME` is the ECMAScript `Date` limit in seconds. hbt-rs stops a little sooner, at what chrono accepts, so a value between the two bounds is a real divergence that no fixture pins.
- **`entityMerge` is field-wise, then `mkEntity`.** Both creation times go into the history and the winner comes back out in `mkEntity` - that is what makes merging associative, and why the removal must not be spelled a second time inside `entityMerge`. `combine` makes absence the identity for every optional field; the directions differ (earliest `createdAt`, latest `lastVisitedAt`, `||` for the flags).
- **`entityEquals` compares every field**, sets by size plus `isSubsetOf`. `entityMerge` short-circuits on it. Keep the test that pins it field by field: an equality that silently ignores a new field makes the merge lose data rather than fail.

### `collection.ts`

`Collection` holds `#nodes`, `#edges` as parallel private arrays plus a `#urls` index, and hands out `Id` handles.

- **`Id` is not a bare index.** It privately holds the issuing collection's `#token`, so equality of shape is not equality of handle and a handle cannot be forged for another collection or another index - `#checkId` turns a foreign one into a throw. This is the same generativity trick as hbt-rs's `Weak<()>` and hbt-go's owning pointer. Keep it when adding APIs that take or return ids.
- **`insert` does not check the URL index; `upsert` does.** Inserting one URL twice leaves two nodes, with `#urls` naming only the second. That hole is deliberate and shared - hbt-rs records the same one on `from_posts` - but **a parser should call `upsert`**.
- **`entities()` returns a copy**, because `updateLabels` replaces the array and a handed-out reference would go stale.
- **`updateLabels` does not chain within a pass**: with `a -> b` and `b -> c`, an `a` becomes `b`. A `null` value drops the label, which is how a mappings file spells a deletion (the empty string never reaches here, `mkLabel` refusing it).
- **`addEdge` dedupes with a linear scan**, so building edges over a flat export is quadratic. Known: #3.

### `yaml.ts`

`formatYaml` builds the schema's shape (`uri`, not `url`; `id`, `entity`, `edges` per node) from `ids()`, which reaches every node where `id(url)` would miss one the insert hole shadowed, and hands it to the [`yaml`](https://eemeli.org/yaml/) package.

- **The sets are sorted, by code point.** The harness compares set-valued fields in order, and the order the other four agree on is hbt-rs's `BTreeSet` - UTF-8 byte order for strings, numeric for `updatedAt`. A JS `Set` iterates in insertion order and `Array.prototype.sort` compares UTF-16 code units, which differ from code points above U+D800; `compareCodePoints` in `order.ts`, which `Collection.labels()` sorts by too, is what closes that gap. Edges are not sorted: they keep the order they were added, as hbt-rs's `Vec` does.
- **It writes YAML 1.1, because the harness reads with PyYAML.** Under 1.2 the package leaves `yes`, `off`, `2024-01-01` and `1:20` plain, and PyYAML reads them back as a boolean, a date and an integer. 1.1 still leaves two strings plain that PyYAML's safe loader refuses outright: `<<` (the merge key) and `=` (the value key). The `compat` option quotes them, given two tags that claim exactly those strings, and the package's merge tag is filtered out of the schema because it otherwise writes `<<` plain whatever `compat` says; its `merge: false` option does not remove it. A fuzz of strings built from PyYAML's resolver grammar found no third.
- **It escapes what PyYAML cannot read as written.** The package escapes C0 in a double-quoted string but writes DEL, C1, U+2028, U+2029, U+FFFE and U+FFFF raw, even inside quotes, and a tab plain; PyYAML refuses the first few as unprintable and folds U+0085, U+2028 and U+2029 as line breaks, silently. A string tag ahead of the package's own double-quotes any string holding one of them and escapes each (`\t`, `\x7f`, `\x85`, `\u2028`). A lone surrogate is escaped too, but libyaml's `CSafeLoader` refuses the escape; no input decoded from UTF-8 can hold one.
- **Absent fields are left out**, as hbt-rs leaves them out; so is an empty `extended`. The harness treats absent, `null` and `[]` alike, but a `createdAt` of 0 is an instant and is written.

Checked beyond the unit tests by rebuilding a `Collection` from every `*.expected.yaml` in the corpus and comparing `formatYaml`'s output with the harness's own `compare`: all of them match.

### `markdown.ts`

`parseMarkdown` reads a document with [markdown-it](https://github.com/markdown-it/markdown-it) and walks its tokens: an H1 is a date and starts afresh, an H2 and below is a label, an inline link or URI autolink is a bookmark, and a nested list joins its links to the one above. Its doc comment gives the rules in full.

- **It follows hbt-rs's `from_markdown` token for token, quirks included.** Only the most recently opened construct decides what text means, so emphasis inside a link ends its name; a list's parent is the last link before it, even one in the paragraph above; a reference link or email autolink is an error. The corpus pins none of these, and hbt-go's goldmark walk differs from hbt-rs on most of them, so matching hbt-rs is a choice, not something the fixtures check.
- **markdown-it is configured to read what pulldown-cmark reads**: the `commonmark` preset (no extensions, raw HTML as HTML), destinations kept as written so that `mkUrl` normalizes them rather than markdown-it's `mdurl` (which would encode `[` and change the key), and no scheme refused, since hbt-rs keeps `javascript:` links.
- **Dates are chrono's `%B %-d, %Y`**, probed against hbt-rs's binary: full or three-letter month in any case, any run of whitespace (or none) where the format has a space, a day of one or two digits, and a year of at most four digits unless signed, within chrono's range.
- **Two differences from hbt-rs are deliberate**, both where markdown-it follows CommonMark to the letter: text broken by a backslash escape or an entity is one label, not several, and U+0000 becomes U+FFFD.
- **Nesting is capped at 200 of markdown-it's levels**, 99 nested lists. Unbounded, its recursion overflows node's stack between 1000 and 2000 levels; at its own limit, `maxNesting`, it silently drops the deeper content, so that is set out of reach and a rule first in its block chain throws instead. Past the cap, `parseMarkdown` throws. hbt-rs has no limit.
- **A link's text is capped at the same depth**, counted in `[`s passed looking for its end, but there a rule first in the inline chain gives up on the link, as `maxNesting` would, rather than refusing the document: the brackets need never close, and a paragraph full of them seldom holds a link. A link in or around a run nested that deep can be lost, where hbt-rs reads it - markdown-it caches the give-up by position, so a later scan through it gives up too - which is a second difference from hbt-rs.

Checked beyond the unit tests by the corpus's 25 Markdown fixtures, which conformance runs, and by a differential fuzz against hbt-rs's binary over generated documents, which agreed on every one but those hitting the two differences above.

### `cli.ts`

`main` reads the arguments with `node:util`'s `parseArgs`, reads and decodes the file, and hands the string to the library.

- **Its surface is hbt-rs's**: `-f`/`--from`, `-t`/`--to`, `-o`/`--output`, `--info`, `--list-tags`, `--mappings`, `-h` and `-V`, with the same short-circuit order (`--info`, then `--list-tags`, then `-t` or `-o`'s extension) and the same exit codes - 2 for a usage error, as clap gives, and 1 for any other. The other errors carry hbt-rs's messages, printed as anyhow prints one, with its causes beneath; a usage error says more than hbt-rs's, whose clap is built without `error-context` and names only the kind of mistake. Every option may be given once, as clap requires, so each is parsed as `multiple` and a second is refused rather than silently winning. The help text is generated from the options table, and `DESCRIPTIONS`' type requires an entry for every option, so the two cannot drift. `hbt-rs/cli/tests/cli.rs` is the reference, and `test/cli/cli.test.ts` covers the same cases. `--schema` is left out, as hbt-go leaves it out: the schema is generated from hbt-rs's types. The `-f` names are henrytill/hbt-data#16's (`markdown`, not `md`).
- **A format with no parser or formatter yet is accepted and then refused**: `-f json` is a valid argument that fails with `there is no json parser yet`, exit 1, not a usage error, so the vocabulary does not change as the parsers land.
- **It decodes UTF-8 strictly and keeps a byte-order mark**, as Rust's `read_to_string` does, rather than replacing a malformed sequence as `readFileSync(..., 'utf8')` would.
- **A mappings value of the empty string drops the label** (henrytill/hbt-go#73); any value that is not a string is an error, as in hbt-rs. The file is read as YAML with `mapAsMap`, so that a key of `42` is refused rather than turned into `'42'`.
- **The version is read from `package.json` at run time**, by the package's own name (`hbt/package.json`, which `exports` lists), so it does not depend on where the build puts `cli.js`. Node has no constant for it: `npm_package_version` is set only under `npm run`, and a JSON import would make `tsc` copy `package.json` into `dist/tsc/`, outside `files`. The commit comes from the environment; see [Nix](#nix).

## Testing

Two layers today: unit tests, run under node and again in a browser, and the conformance harness against the built CLI.

**Unit tests.** `node --test` over the tests as `tsc` compiles them, in `test/unit/` and `test/cli/`, so `npm test` builds first (its `pretest` script):

```sh
npm test                                     # build, then every dist/tsc/test/**/*.test.js
node --test dist/tsc/test/unit/entity.test.js      # one file, after a build
```

They are the only thing actually covering this repo right now. Write them against the exported API rather than internals - `Id`'s owner is private precisely so that nothing, tests included, can reach around it.

**Stay on `node:test` and `node:assert`.** Do not add a test framework; if the tests come to need something more featureful, raise it with the maintainer first.

**The same unit tests in a browser.** `build.mjs` bundles them a second time for the browser, with `node:test` and `node:assert/strict` resolved to the stand-ins in `test/browser/`, and `test-browser.mjs` loads the page in headless Chromium (`--dump-dom`) and reads the report the stand-in writes into it. It needs no Nix: any Chromium or Chrome will do.

```sh
npm run test:browser                                  # build, then run under `chromium` from PATH
CHROMIUM=/path/to/chrome npm run test:browser         # any other Chromium or Chrome binary
```

`test/cli/` is the exception: its test spawns the built CLI, so `build.mjs` bundles only `test/unit/`. This is the run that shows the library behaves the same in both places, which matters most once a parser takes an injected `DOMParser`: node's tests get the CLI's, the browser's get the native one. The stand-ins implement only what the tests use - `describe`, `it`, and `ok`/`equal`/`notEqual`/`deepEqual`/`throws` with strict semantics. **A test that reaches for more (`before`, `mock`, `assert.match`) fails to typecheck** until the stand-in grows it: `test/unit/tsconfig.json` maps both modules to the stand-ins with `paths`, which esbuild reads too when `build.mjs` bundles them, and gives the tests no Node types, while the emitted imports stay `node:` ones for node to run; `deepEqual` throws on a built-in it does not know rather than calling two of them equal.

**Source maps.** `tsc` and esbuild both write one beside every output, but node reads them only under `--enable-source-maps`. `npm test` passes it, so a failure's stack names the line in `test/**/*.test.ts` rather than in the compiled output. The browser report prints only each error's message, and `bin/hbt` does not pass the flag.

**Shared fixtures.** `test/data/` is a git submodule of [hbt-data](https://github.com/henrytill/hbt-data), consumed by all five implementations. Clone with `--recurse-submodules`, or run `git submodule update --init`. Changing a fixture is a cross-language decision: it will go red in the others until their fixes land.

**Never edit `test/data/` in place.** It is detached at a revision five repositories pin. Fixture and harness work belongs in an hbt-data checkout of its own, lands there first, and reaches this repo as a pointer bump. A missing or stale submodule shows up as mass failures rather than as a clear error.

**Conformance.** `test/data/` also carries hbt-data's conformance harness (henrytill/hbt-data#14), which runs every fixture through the built `hbt` and compares what the CLI writes. It is the `conformance` flake check, via hbt-data's exported `lib.check`; `test/data/` is also the `hbt-data` flake input (`path:./test/data`), so bumping the submodule needs no relock.

```sh
nix build -L .#checks.x86_64-linux.conformance    # or just nix flake check -L
```

**`conformance.waivers` at the repo root waives every fixture whose parser is not written yet** - the HTML and Pinboard ones - with the reason `stub`. The harness reports each as `XFAIL` and the check passes. This is the mechanism that lets a partial implementation sit in the matrix rather than being excluded from it, and it is self-clearing: once a parser lands, the fixtures it satisfies report **`XPASS`**, which _fails_ the run until the waiver is removed. So the way to land a parser is to write it, watch conformance go red with `XPASS`, and delete those lines from `conformance.waivers` in the same commit. Do not pre-emptively remove waivers for work not yet done.

Three further rules about that file, each learned the expensive way:

- **A waiver's reason names the issue that removes it.** `stub` is the exception this repo gets for a format with no parser at all; a waiver added later should read `markdown/superseded_created_at # henrytill/hbt-js#N`.
- **A stale waiver fails the run**, "stale" meaning it names a fixture this corpus does not have - it does not merely warn. So a waiver and the `test/data` bump that brings in the fixture it waives **must be one commit**: the waiver is stale before the bump and the fixture fails after it, so neither is landable alone.
- **A corpus error is not waivable.** A malformed expectation file is hbt-data's failure, not this implementation's, and no waiver lets it ride along at exit 0.

**None of the other four implementations carries a `conformance.waivers` file** - they satisfy the corpus outright. This repo is the only one with waivers, and the file should shrink to nothing as the parsers land.

The harness's flags, what counts as a match, and its timezone policy are documented in `test/data/README.md`. Nothing pins `TZ`: the implementations are meant to be timezone-invariant, and the harness runs under the ambient zone so it can notice when one is not. `--tz` forces a zone when reproducing a failure.

## Development Commands

There is no system-wide toolchain: node, npm and the harness's Python come from the flake.

```sh
nix develop          # then work normally; linkNodeModulesHook links node_modules
npm run build        # tsc -b (the library and the CLI), then build.mjs (the bundles)
npm run clean        # delete dist/, after deleting or renaming a source file
npm test             # npm run build, then node --test
npm run test:browser # npm run build, then the tests in headless Chromium
npm run fmt          # dprint fmt (`npx dprint check` reports without writing)
```

The dev shell's `linkNodeModulesHook` links `node_modules` from the lockfile, so **a plain `npm install` inside it writes a real `node_modules` over the link**. Add a dependency with `--package-lock-only`, which updates `package.json` and `package-lock.json` without installing anything:

```sh
npm install --package-lock-only --save-dev <dep>   # or without --save-dev for a runtime dep
```

**That command does write one file into the tree: `node_modules/.package-lock.json`, replacing the hook's link with a regular file.** The hook then prints `cowardly refusing to link` and leaves every package, the new one included, unlinked. Delete that file, then leave and re-enter the shell, so the hook relinks from the new lockfile. The lockfile is the input Nix builds from - `importNpmLock` reads it - so a dependency change that does not reach it builds against the old tree.

### Nix

```sh
nix flake check -L   # the conformance and browser checks (browser on Linux only)
nix build -L         # the hbt package
```

`self.submodules = true` is set, so flake builds see `test/data/`. The package is a `buildNpmPackage` using `importNpmLock`; `bin/hbt` in the result is a generated wrapper that invokes node on `dist/tsc/cli/cli.js`. `cli/cli.ts` starts with `#!/usr/bin/env node`, which `tsc` keeps, so the `hbt` that a plain `npm install` links runs too.

**`--version` reports the revision**, as the other four do (`hbt 0.1.0 (7e16a14)` from hbt-rs, `hbt 0.1.0-21ebc53` from hbt-go); hbt-analysis's benchmark harness reads it to record which build produced a measurement. The package's `postInstall` wraps `bin/hbt` to set `HBT_COMMIT_SHORT_HASH` from `self.shortRev or self.dirtyShortRev`, the variable hbt-rs's flake bakes in, and the CLI prints it after the version from `package.json`, in hbt-rs's form. Reading `self`'s revision is also what forces hbt-analysis to use `git+file:` inputs rather than `path:`: a `path:` reference to this flake has no revision and fails to evaluate. Outside Nix nothing sets the variable, and `--version` prints the version alone.

`nix build` prints `npm warn Unknown env config "nodedir"` a few times. It is benign and not this repo's: nixpkgs' `npmConfigHook` exports `npm_config_nodedir`, which npm does not recognize. npm plans to make unknown env configs an error in npm 13, which nixpkgs will not bundle before Node 27 at the earliest; recheck then, or if the build starts failing on it.

A `github:` flake reference carries no submodules, so it lacks the `hbt-data` input and `nix flake check` fails on it; use `git+https://github.com/henrytill/hbt-js?submodules=1` or a checkout.

## CI

`.github/workflows/ci.yml` runs on pushes and PRs to `master`, with no path filter:

- **Linux (npm) (24.x)** - `npm ci`, `npm run build`, `npm test`, and `npm run test:browser` under the runner's Google Chrome, on node 24 with an npm cache.
- **Linux (Nix flake)** - `nix flake check -L` (conformance, and the unit tests in headless Chromium) and `nix build -L`, through the `henrytill` cachix cache.

Both are required status checks. The npm job is the only one of the five that uses a `strategy.matrix`, which is why its check context carries the node version; **bumping that version renames the check**, so the branch protection contexts have to change in the same breath or `master` silently stops being gated.

**dprint runs nowhere in CI**, so formatting is on you - see REMEMBER. Two other workflows: `zizmor.yml` (Actions security scan, path-filtered to `.github/**` plus a weekly cron) and `update.yml` (monthly flake lock bump).

## Git Workflow

**Never commit to `master`.**

```sh
git checkout -b <topic>   # branch first, before making any changes
# ... work, commit ...
git push -u origin <topic>
gh pr create
gh pr merge --rebase      # after CI is green
```

If changes have already been made on `master` by mistake, move them to a branch before committing. `git branch -f` on the branch you are _not_ on is the clean way to rewind one without disturbing the working tree or the submodule.

### Branch protection on `origin/master`

The GitHub remote enforces this; direct pushes to `master` will be rejected.

| Rule                      | Setting                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| Pull request required     | yes, 0 approvals (stale reviews dismissed)                                    |
| Required status checks    | `Linux (npm) (24.x)`, `Linux (Nix flake)`, strict (branch must be up to date) |
| Linear history            | required                                                                      |
| Conversation resolution   | required                                                                      |
| Force pushes / deletions  | blocked                                                                       |
| Applies to administrators | yes (no bypass)                                                               |

### Merge settings

Rebase is the only merge method enabled; squash merges and merge commits are turned off. Merged branches are deleted automatically on GitHub, so prune locally afterwards:

```sh
git fetch --prune
git branch -D <topic>   # -d may refuse: rebase merges rewrite SHAs
```

Rebase merges always create new commit SHAs, so a local branch kept after merging will look diverged from `master`. Delete it rather than reusing it.

### Commit messages

A single imperative sentence saying what the commit does, capitalized, with no scope prefix - `Floor timestamps rather than truncating toward zero`, `Return a snapshot from entities(), not the live array`. This differs from hbt-rs and hbt-ocaml, which use a `<scope>: <description>` form; follow what this repo's log already does.

Wrap the body at the usual width and explain _why_, particularly which invariant was wrong and what now makes it unrepresentable. Reference companion issues in the other repos by full `henrytill/hbt-rs#65` form, since bare `#65` resolves to this repo.

**No commit SHAs in commit messages** - not as a range, not as a submodule pointer's old and new values, not inline in prose. Name what moved instead: "advances test/data to hbt-data master", "the revision the other four already pin". A SHA is unreadable at review time and goes stale the moment history is rewritten, which rebase merges do on every PR. Issue and PR references are the opposite and are preferred.

Do **not** hard-wrap prose in GitHub issue bodies, PR bodies, or comments - one long line per paragraph, and let GitHub wrap it. Commit messages are the exception.

## Conventions

- **Tabs, width 4, 140 columns, single quotes, semicolons, and line breaks mostly yours.** `dprint.json` is the authority and `.dir-locals.el` matches it for Emacs. dprint wraps only a line longer than 140 columns; otherwise it keeps the layout it is given (`preferSingleLine: false`): a construct whose first element starts on a new line stays multi-line even when it would fit on one, and one that does not stays on one line. So to break a construct across lines, put a line break after its opening bracket. Its TypeScript, JSON and Markdown plugins come from npm, pinned by the lockfile, rather than from dprint's default plugin URLs, so formatting needs no network. `excludes` holds `test/data` (the corpus is hbt-data's to format). There is no YAML or HTML plugin, so `.github` and `test/browser/index.html` are not formatted - which for `.github` is deliberate, since the workflows are copied from the four sibling repos and should not diverge from them.
- **Prefer an existing config's own mechanism to a new config file.** Keeping the compiled tests out of the published package was first attempted here as a `tsconfig.build.json` / `tsconfig.test.json` split and rejected; the one-line answer was a negated pattern in `package.json`'s existing `files` field, for an identical tarball, until moving the tests out of `src/` made even that unnecessary. npm, tsc and dprint each have a field or ignore file for most of these cases. If a split is genuinely needed, say why and ask first - as the per-environment tsconfig projects were, in henrytill/hbt-js#27, because one `compilerOptions` cannot give the library and the CLI different `types`.
- **There is no linter.** The author's other TypeScript projects ([bits-js](https://github.com/henrytill/bits-js), [incr](https://github.com/henrytill/incr)) run eslint; this one does not yet, so `tsc` under `strictest` is the whole static check. **It covers the `.mjs` scripts too**: `build.mjs` and `test-browser.mjs` start with `// @ts-check`, and `tsconfig.scripts.json`'s `allowJs` brings them into the build, so a script gets the same strictness as the library. Give a new script the same header and put it at the root beside them, where the project's `*.mjs` picks it up. The project sets `noEmit`, since node runs the scripts as they are.
- **A type's functions are `mkFoo` and `fooVerb`, exported flat**: `mkUrl`, `mkTime`, `mkEntity` build; `entityEquals`, `entityMerge` operate. `src/index.ts` groups each module as a namespace (`export * as entity`), which still tree-shakes because it is a static namespace of real exports. Do not group a type's functions inside a module, as an `export namespace` or a const object: neither tree-shakes property by property (checked with esbuild), which is why both were rejected. Nine schemes were tried before this one, recorded in PR #2; no TypeScript style guide prescribes one, so do not reopen the question on style grounds. Two related findings from the same round: a TypeScript overload cannot span same-named exports from two files ("Duplicate identifier"), so `mkTime` is one overloaded function over seconds and `Date`; and `Collection` uses `#private` fields deliberately, for privacy at runtime, against the Google guide's preference for `private`.
- **Third-party modules are imported as namespaces**: `import * as yaml from 'yaml'` and `yaml.stringify(...)`, never `import { stringify } from 'yaml'`, so a bare function name always means one of this repo's own. Relative imports stay named (`import { mkEntity } from './entity.js'`).
- **`.js` extensions on relative imports**, as ESM and `verbatimModuleSyntax` require: `from './entity.js'`, even though the file is `entity.ts`. The exception is a plain node script importing TypeScript source, which node runs by stripping its types: `test-browser.mjs` imports `./test/browser/test.ts`, and `rewriteRelativeImportExtensions` is on in `tsconfig.scripts.json` so that `tsc` accepts it. The `.ts` modules themselves keep `.js`.
- **Comments explain the bug or the decision that motivated the code.** The doc comments here name the sibling implementation and the test or issue that settled a rule; this is deliberate and worth continuing, since it stops a later simplification from quietly reintroducing a fixed bug or diverging from the other four.
- **Optional fields are omitted, not nulled**, on the wire and in the type. Build them with the `...(x !== undefined && { x })` spread that `entityMerge` uses, which `exactOptionalPropertyTypes` is what makes necessary.
