# hbt-js

## REMEMBER

**Use `gh` for everything on GitHub** - queries as well as writes, rather than the GitHub MCP server or fetching github.com pages

**Never work directly on `master`** - branch first, land via PR (see [Git Workflow](#git-workflow))

**Run `pnpm run fmt` before every commit** - dprint is not a CI check, so a misformatted file lands silently and churns the next diff

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

1. **Markdown parser**, on [markdown-it](https://github.com/markdown-it/markdown-it) rather than the [commonmark.js](https://github.com/commonmark/commonmark.js) first planned. **Done**: `packages/hbt/src/markdown.ts`, which passes all 25 fixtures.
2. **CLI** in `packages/hbt-cli/src/cli.ts`: arguments, file reading and `--version`, kept out of the library. **Done**, with hbt-rs's flags and messages (see [below](#clits)).
3. **The library and the CLI as workspace packages** (henrytill/hbt-js#32), so that a dependency only the CLI uses - the DOM implementation it will supply from Pinboard XML on - is not installed by every library consumer. **Done**: `packages/hbt` and `packages/hbt-cli`, first as an npm workspace and then as a pnpm one (henrytill/hbt-js#37; see [Layout](#layout) and [Nix](#nix)).
4. **Pinboard JSON, then Pinboard XML, then Netscape HTML.** Remove waivers as fixtures pass, as [Testing](#testing) describes.

The HTML and XML parsers are written against the DOM API and take a `DOMParser` (see Core Principles). Which one the CLI supplies is open: [linkedom](https://github.com/WebReflection/linkedom) (lean) or [jsdom](https://github.com/jsdom/jsdom) (fidelity), chosen by running both against the fixtures. Netscape bookmark HTML is not well-formed XML (unclosed `<DT>` and `<p>`), so it needs a real HTML parser, and its fixtures are where the two are likeliest to differ from each other and from a browser. If injection proves awkward, the fallback is [parse5](https://github.com/inikulin/parse5) and [@xmldom/xmldom](https://github.com/xmldom/xmldom) imported by the library directly, which behave the same everywhere.

## Core Principles

- **Typecheck early & often**: types are not only a correctness check, they guide the design. `tsconfig.base.json`, which every project extends, takes its checks from [`@tsconfig/strictest`](https://github.com/tsconfig/bases) - `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` (so an index signature is read as `env['NAME']`, not `env.NAME`), no unused locals or parameters, and the rest - and adds `verbatimModuleSyntax`. Keep them on; `exactOptionalPropertyTypes` in particular is what makes "absent" and "present and `undefined`" different things, which the optional timestamps depend on.
- **Branded types over bare primitives**: `Url`, `Name`, `Label`, `Extended` and `Time` are all `Brand<...>` aliases over `string` or `number`, so the checker catches field mix-ups the way hbt-rs's newtypes and hbt-go's named types do. Follow the pattern when adding a field. The brand is a `declare const brand: unique symbol`, so it exists only at the type level and costs nothing at runtime.
- **Make illegal states unrepresentable**: where TypeScript cannot, constrain construction to one place. `mkEntity` is the only thing that builds an `Entity`; `mkName`, `mkLabel` and `mkExtended` are the only things that build their brands, and each refuses the empty string.
- **The library runs in a browser too**: hbt-js starts as a CLI but is meant to run in a browser as well, so everything but the CLI and the scripts stays free of Node APIs (`fs`, `process`, `path`, `Buffer`). The library takes and returns strings; reading files, parsing arguments and choosing a format from an extension belong to the CLI. A parser that needs a platform facility, such as a `DOMParser` for HTML and XML, takes it as an argument, so the browser passes its own and the CLI supplies one.
  - **`tsc -b` enforces it, with one directory and one project per environment** (henrytill/hbt-js#27). `tsconfig.json` is a solution file that only references them, and every one extends `tsconfig.base.json`, which is plain ECMAScript - ES2025, `types: []`, no `DOM`. Two keep that environment: `packages/hbt/src/` (the library) and `packages/hbt/test/` (its unit tests, typed against the stand-ins in its `stubs/`, whose page runner declares the few DOM globals it uses by hand; see [Testing](#testing)). `packages/hbt-cli/src/` (the CLI), `packages/hbt-cli/test/` (its test) and `scripts/` (the `.mjs` scripts) extend `@tsconfig/node24` after the base, which overrides the environment with Node 24's and leaves the rest. No `@tsconfig` package describes plain ECMAScript - `recommended` is ES2016 and CommonJS - so the base spells the environment out, over `strictest`, which sets checks alone. So `process`, `Buffer`, `document` or an import of `node:fs` in the library fails the build, while the same line in the CLI passes; esbuild's browser bundle alone would have caught only the import. Adding `DOM` to the library's `lib` would undo this, not help: an injected facility is instead a small interface the library declares, the way `packages/hbt/test/stubs/page.ts` declares `document`, which the native `DOMParser` and the CLI's alike satisfy. **Where a file goes decides what it may use**: a module that needs Node goes in `packages/hbt-cli/`, never `packages/hbt/`.
- **No recursion**: avoid recursive calls over user-provided data, which can nest arbitrarily deeply. The parsers in the other four all walk an explicit stack; the ones here should too when they land. A dependency counts: markdown-it's block parser recurses once per level of nesting, so `markdown.ts` bounds it and refuses a document past the bound (see [below](#markdownts)).

## Layout

A pnpm workspace of two packages, both ESM (`"type": "module"`):

- **`@henrytill/hbt`** (`packages/hbt/`) - the library, with its unit tests and the stand-ins they run against in a browser.
- **`@henrytill/hbt-cli`** (`packages/hbt-cli/`) - the CLI, with its test; its `bin` is `hbt`. It depends on the library and imports it by name, through the workspace's link in `node_modules`, so it is held to the library's public API (`src/index.ts`'s namespaces) like any other consumer.

Every package is under the `@henrytill` scope, since `hbt` on the npm registry is someone else's; the root (`@henrytill/hbt-js`) too, though it is private. `pnpm-workspace.yaml` lists the packages, and `allowBuilds` names the two dependencies whose install scripts pnpm may run (esbuild and dprint, which fetch their binaries); the root `package.json` holds the scripts and every dev dependency (`typescript`, `esbuild`, `dprint`, the `@tsconfig` bases); there is one lockfile, `pnpm-lock.yaml`, at the root. Each package's `dependencies` are only what that package imports. **The two are versioned together**: the CLI depends on the library as `workspace:*`, which `pnpm pack` and `pnpm publish` rewrite to the library's version exactly, so the published CLI always names the library it was built with; the CLI's test checks that `--version`, the CLI's own, is the library's, which catches bumping one without the other; and the flake reads its `version` from the CLI's `package.json`. A `workspace:` range with a version in it (`workspace:0.1.0`) would guard nothing: pnpm links the workspace's library whatever its version, and the tarball would name the stale one. The tooling stays outside the packages: `tsconfig.base.json` and the solution `tsconfig.json` at the root, and the scripts in `scripts/`.

The packages are built twice over: `tsc -b` builds the projects in [Core Principles](#core-principles) and writes everything that runs under node - the library and the CLI - unbundled, as the `prebuild` script, and `scripts/build.mjs` then uses esbuild to write the browser bundles.

| File                               | Role                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/hbt/src/entity.ts`       | The branded types, `Entity`, `mkEntity`, `entityEquals`, `entityMerge`, `ParseError`                                |
| `packages/hbt/src/whatwg-url.d.ts` | Types for the one whatwg-url module `mkUrl` imports, which ships none                                               |
| `packages/hbt/src/collection.ts`   | `Id` and `Collection` - the graph, the URL index, `upsert`, `updateLabels`                                          |
| `packages/hbt/src/order.ts`        | `compareCodePoints`, shared by the modules but not re-exported, so not part of the package's API                    |
| `packages/hbt/src/yaml.ts`         | `formatYaml` - a `Collection` as `collection.schema.json` describes it                                              |
| `packages/hbt/src/markdown.ts`     | `parseMarkdown` - a Markdown document as a `Collection`                                                             |
| `packages/hbt/src/index.ts`        | The library's entry point: re-exports each module above as a namespace (`entity`, `collection`, `yaml`, `markdown`) |
| `packages/hbt/test/`               | Unit tests of the library                                                                                           |
| `packages/hbt/test/stubs/`         | Stand-ins for `node:test` and `node:assert/strict`, and the test page and its runner                                |
| `packages/hbt-cli/src/cli.ts`      | The CLI entry point, and the only module in either package that may use Node APIs                                   |
| `packages/hbt-cli/test/`           | The CLI's test, which spawns the built CLI                                                                          |
| `tsconfig*.json`                   | The solution file and the shared base; each project sits in its directory (see Core Principles)                     |
| `scripts/`                         | The `build`, `test:browser` and `clean` scripts: browser bundles, the tests in headless Chromium, deleting `dist/`  |
| `test/data/`                       | The [hbt-data](https://github.com/henrytill/hbt-data) submodule: corpus, conformance harness, flake                 |

- `packages/hbt/dist/src/` - the library from `tsc`: one `.js`, `.d.ts` and source map per module, and what its `package.json`'s `exports` names, so consumers can import only `@henrytill/hbt` itself. **`exports` names the `.js` alone, with no `types` condition**: TypeScript finds the `.d.ts` beside it, so a `types` condition would add nothing (and one broke the npm dev shell, #31, which rewrote the file with its keys sorted). It is unbundled, so its third-party imports stay imports: **a dependency the library uses is a `dependency`**, which the consumer installs along with its types, and the consumer's bundler picks that package's browser or node build. The extra `src/` is there because both of a package's projects share one `rootDir`, the package, and one `outDir`, its `dist/`, which so mirrors the package: the tests' outputs land in `dist/test/`, outside `files`, and nothing published needs leaving out. `tsconfig.base.json` sets both once, relative to the extending project with `${configDir}`, so a new project in a package needs neither. They fit `scripts/` too, the one project outside the packages: its `rootDir` is the repository and its `outDir` the root's `dist/`, where only its `.tsbuildinfo` lands, since it emits nothing.
- `*.tsbuildinfo` - one per project, `tsc -b`'s record of what it built, written beside the project's outputs, so those of each package's `src/` land in published directories; `files` leaves out every one by pattern, so a new project needs nothing of its own. **Every `dist/` belongs to the build: reset them with `pnpm run clean`, which deletes every one with `scripts/clean.mjs`, run in each package and at the root, never by deleting files inside one.** `tsc -b` trusts its record without checking that the outputs it lists still exist, so a hand-deleted `.js` is not rebuilt and its dependents fail with `TS6305`. Nor does any build remove the outputs of a source that is gone (`tsc -b --clean` included), so a deleted or renamed `*.test.ts` leaves a compiled copy that `pnpm test`'s glob keeps running. A stale output in either package's `dist/src/` would ship, too, so **each package's `prepack` deletes its `dist/` and rebuilds its `src` project** (`tsc -b src`, which for the CLI builds the library first through the reference): `pnpm pack` and `pnpm publish` always package a fresh build, and packing both builds each once, without the browser bundles neither publishes. The Nix package's `pnpm deploy` copies the published files of the build its build phase has just made from clean (see [Nix](#nix)).
- `packages/hbt-cli/dist/src/cli.js` - the CLI, from `tsc` too, and what `bin` names; `exports` names only `package.json`, so consumers cannot import it. Unbundled, it runs the library as consumers get it, so conformance tests the shipped library. **A dependency only the CLI uses is a `dependency` of `hbt-cli`**, which library consumers never install: the DOM implementation the CLI will supply goes here.
- `dist/browser/hbt.js` - the library, bundled by esbuild for the browser, at the root since `pnpm run build` runs there. Nothing consumes it yet, and it is in neither package: a browser app that installs `@henrytill/hbt` bundles its `dist/src/`, and the only consumer the tarball copy would reach is a CDN. It is built so that a dependency reaching for a Node builtin fails the build (`Could not resolve "fs"`) the day it is added, not the day a browser front end is. If a CDN use case appears, build it into `packages/hbt/dist/` and publish it with an `exports` subpath (`"./browser"`) so it is a supported entry rather than a stray file. **Choose library dependencies that bundle for both platforms.**
- `dist/test/browser/` - every test file in one esbuild script, beside the page that loads it. Not published.

The library's `dist/src/` is for whoever loads it, not only node: a browser app that installs `@henrytill/hbt` and bundles it gets `dist/src/index.js` too, not `dist/browser/`, which is for loading directly with `<script type="module">`. Its third-party imports resolve by whoever loads it - node takes each dependency's `node` export condition, a browser bundler the `browser` one - so the browser and node may run different builds of the same dependency.

### `entity.ts`

`Entity` is a `type`, not a class: a readonly record whose multi-valued fields (`updatedAt`, `names`, `labels`, `extended`) are `ReadonlySet` and whose optional ones (`createdAt`, `shared`, `toRead`, `isFeed`, `lastVisitedAt`) are absent rather than null when unset.

- **`mkEntity` holds the normal form.** An update never repeats `createdAt`; an update strictly _below_ `createdAt` is a different thing and stays. Every construction goes through it, so the rule holds by construction rather than by a normalizing pass. hbt-rs asserts it on serialize and hbt-go calls `Normalize()` at the parse and decode boundaries - **this should grow the same check at the serialize and decode boundaries when they land**, since a decoded collection is input like any other.
- **`mkUrl` parses with whatwg-url's `lib/url-state-machine.js`, not the platform's `URL` or the package entry**; the comment says why. That module is not public API and whatwg-url is held at 15, so run `pnpm run test:browser` after any bump. The form is the current spec's, which differs from hbt-rs's in a few places the comment lists; no fixture pins either yet. It is also about 85x slower per call than the platform's `URL`, mostly percent-encoding every code point through a `TextEncoder`. Known: #21.
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

- **Its surface is hbt-rs's**: `-f`/`--from`, `-t`/`--to`, `-o`/`--output`, `--info`, `--list-tags`, `--mappings`, `-h` and `-V`, with the same short-circuit order (`--info`, then `--list-tags`, then `-t` or `-o`'s extension) and the same exit codes - 2 for a usage error, as clap gives, and 1 for any other. The other errors carry hbt-rs's messages, printed as anyhow prints one, with its causes beneath; a usage error says more than hbt-rs's, whose clap is built without `error-context` and names only the kind of mistake. Every option may be given once, as clap requires, so each is parsed as `multiple` and a second is refused rather than silently winning. The help text is generated from the options table, and `DESCRIPTIONS`' type requires an entry for every option, so the two cannot drift. `hbt-rs/cli/tests/cli.rs` is the reference, and `packages/hbt-cli/test/cli.test.ts` covers the same cases. `--schema` is left out, as hbt-go leaves it out: the schema is generated from hbt-rs's types. The `-f` names are henrytill/hbt-data#16's (`markdown`, not `md`).
- **A format with no parser or formatter yet is accepted and then refused**: `-f json` is a valid argument that fails with `there is no json parser yet`, exit 1, not a usage error, so the vocabulary does not change as the parsers land.
- **It decodes UTF-8 strictly and keeps a byte-order mark**, as Rust's `read_to_string` does, rather than replacing a malformed sequence as `readFileSync(..., 'utf8')` would.
- **A mappings value of the empty string drops the label** (henrytill/hbt-go#73); any value that is not a string is an error, as in hbt-rs. The file is read as YAML with `mapAsMap`, so that a key of `42` is refused rather than turned into `'42'`.
- **The version is read from `package.json` at run time**, by the package's own name (`@henrytill/hbt-cli/package.json`, which `exports` lists), so it does not depend on where the build puts `cli.js`; the library's is the same, the two being versioned together. Node has no constant for it: `npm_package_version` is set only under a package manager's `run`, and a JSON import would make `tsc` copy `package.json` into `dist/`, outside `files`. The commit comes from the environment; see [Nix](#nix).

## Testing

Two layers today: unit tests, run under node and again in a browser, and the conformance harness against the built CLI.

**Unit tests.** `node --test` over the tests as `tsc` compiles them, in each package's `test/`, so `pnpm test` builds first (its `pretest` script):

```sh
pnpm test                                         # build, then every packages/*/dist/test/**/*.test.js
node --test packages/hbt/dist/test/entity.test.js  # one file, after a build
```

They are the only thing actually covering this repo right now. Write them against the exported API rather than internals - `Id`'s owner is private precisely so that nothing, tests included, can reach around it.

**Stay on `node:test` and `node:assert`.** Do not add a test framework; if the tests come to need something more featureful, raise it with the maintainer first.

**The same unit tests in a browser.** `scripts/build.mjs` bundles them a second time for the browser, with `node:test` and `node:assert/strict` resolved to the stand-ins in `packages/hbt/test/stubs/`, and `scripts/test-browser.mjs` loads the page in headless Chromium (`--dump-dom`) and reads the report that `stubs/page.ts`, the runner the stand-in registers the tests with, writes into it. The runner is kept out of the stand-in so that `node:test` as the tests see it exports nothing node's own lacks. It needs no Nix: any Chromium or Chrome will do.

```sh
pnpm run test:browser                                 # build, then run under `chromium` from PATH
CHROMIUM=/path/to/chrome pnpm run test:browser        # any other Chromium or Chrome binary
```

The CLI's test is the exception: it spawns the built CLI, so `scripts/build.mjs` bundles only the library's. This is the run that shows the library behaves the same in both places, which matters most once a parser takes an injected `DOMParser`: node's tests get the CLI's, the browser's get the native one. The stand-ins implement only what the tests use - `describe`, `it`, and `ok`/`equal`/`notEqual`/`deepEqual`/`throws` with strict semantics. **A test that reaches for more (`before`, `mock`, `assert.match`) fails to typecheck** until the stand-in grows it: `packages/hbt/test/tsconfig.json` maps both modules to the stand-ins with `paths`, which esbuild reads too when `scripts/build.mjs` bundles them, and gives the tests no Node types, while the emitted imports stay `node:` ones for node to run; `deepEqual` throws on a built-in it does not know rather than calling two of them equal.

**Source maps.** `tsc` and esbuild both write one beside every output, but node reads them only under `--enable-source-maps`. `pnpm test` passes it, so a failure's stack names the line in the `*.test.ts` rather than in the compiled output. The browser report prints only each error's message, and `bin/hbt` does not pass the flag.

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

There is no system-wide toolchain: node, pnpm and the harness's Python come from the flake.

```sh
nix develop           # then work normally; the shell hook installs node_modules
pnpm run build        # tsc -b (the library and the CLI), then scripts/build.mjs (the bundles)
pnpm run clean        # delete every dist/, after deleting or renaming a source file
pnpm test             # pnpm run build, then node --test
pnpm run test:browser # pnpm run build, then the tests in headless Chromium
pnpm run fmt          # dprint fmt (`pnpm exec dprint check` reports without writing)
```

The shell hook runs `pnpm install` offline, from the store the flake fetched, on every entry; with nothing to do it takes a few tens of milliseconds and prints nothing. **A `node_modules` left by the npm dev shell holds links into the Nix store, which pnpm cannot write through: delete it once before entering.** Add a dependency with `--lockfile-only`, which updates `package.json` and `pnpm-lock.yaml` without installing anything:

```sh
pnpm add --lockfile-only -D -w <dep>                        # a dev dependency, at the root
pnpm add --lockfile-only --filter @henrytill/hbt <dep>      # a runtime one, in the package that imports it
```

**Then update `pnpmDeps.hash` in `flake.nix`**, as [Nix](#nix) describes, and leave and re-enter the shell, which installs from the new store. Until the lockfile and the hash agree, the hook fails, loudly, and the shell keeps the old `node_modules`.

### Nix

```sh
nix flake check -L   # the conformance and browser checks (browser on Linux only)
nix build -L         # the hbt package
```

`self.submodules = true` is set, so flake builds see `test/data/`. The package is a `stdenv.mkDerivation` on nixpkgs' pnpm hooks; `bin/hbt` in the result is a generated wrapper that invokes node on the CLI package's `dist/src/cli.js`. `cli.ts` starts with `#!/usr/bin/env node`, which `tsc` keeps, so the `hbt` that installing the published package links runs too.

- **The dependencies are a fixed-output derivation.** `fetchPnpmDeps` fetches a store holding everything `pnpm-lock.yaml` names, which Nix checks against the `hash` beside it, so **every lockfile change needs a new hash**: set it to `""`, run `nix build`, and copy the `got:` hash from the mismatch it reports. A hash left unchanged is worse than a wrong one: Nix finds the old store under it and reuses it without fetching, and the build fails later, offline, on a package that store lacks (`ERR_PNPM_NO_OFFLINE_TARBALL`). Dependabot's updates change the lockfile without the hash, so each needs a commit updating it before the Nix job passes.
- `pnpmConfigHook` installs from that store, offline, and `pnpmBuildHook` runs the root's `pnpm run build`. The `installPhase` is `pnpm deploy --prod` of the CLI at `lib/node_modules/@henrytill/hbt-cli/`: its published files and its production `node_modules`, with the library among them as its published files rather than a link into the build. It then deletes pnpm's own records, which deploy leaves and an install would not, among them `node_modules/.pnpm-workspace-state-v1.json`, stamped with the time of the build, which would make the package unreproducible; and it puts back the CLI's own `package.json`, which deploy rewrites to name the library by its path in the build. One `makeWrapper` writes `bin/hbt`, running node on the script the CLI's `bin` names and setting the commit (below); nixpkgs has no pnpm install hook, so every pnpm package there writes this phase itself. The names and directories it needs Nix reads from the CLI's `package.json` at evaluation time.
- **The dev shell does not use `pnpmConfigHook`.** That hook is for the sandbox: it writes the store and its other settings into the user's pnpm config with `pnpm config set`, and unpacks the store into a fresh temporary directory each time. The flake unpacks the store once, into the Nix store (`pnpmStore`), and the shell hook passes the settings as flags, for that install alone. It trusts the lockfile as the hook does (`--trust-lockfile`), since pnpm 12 would otherwise check it against the registry, which `fetchPnpmDeps` has done. pnpm finds the workspace root from any directory, so entering the shell from a subdirectory makes no `node_modules` there; outside the checkout, where pnpm would start a project or install another workspace, the hook installs nothing and says so.

**`--version` reports the revision**, as the other four do (`hbt 0.1.0 (7e16a14)` from hbt-rs, `hbt 0.1.0-21ebc53` from hbt-go); hbt-analysis's benchmark harness reads it to record which build produced a measurement. The package's `bin/hbt` wrapper sets `HBT_COMMIT_SHORT_HASH` from `self.shortRev or self.dirtyShortRev`, the variable hbt-rs's flake bakes in, and the CLI prints it after the version from `package.json`, in hbt-rs's form. Reading `self`'s revision is also what forces hbt-analysis to use `git+file:` inputs rather than `path:`: a `path:` reference to this flake has no revision and fails to evaluate. Outside Nix nothing sets the variable, and `--version` prints the version alone.

A `github:` flake reference carries no submodules, so it lacks the `hbt-data` input and `nix flake check` fails on it; use `git+https://github.com/henrytill/hbt-js?submodules=1` or a checkout.

## CI

`.github/workflows/ci.yml` runs on pushes and PRs to `master`, with no path filter:

- **Linux (pnpm) (24.x)** - `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm run test:browser` under the runner's Google Chrome, each test script building first, on node 24 with a pnpm cache. `pnpm/action-setup` installs pnpm by version, the one the flake's nixpkgs has; bump it with `flake.lock`. There is no `packageManager` field instead: pnpm runs the version it names in place of its own, which in the dev shell means one fetched from the registry.
- **Linux (Nix flake)** - `nix flake check -L` (conformance, and the unit tests in headless Chromium) and `nix build -L`, through the `henrytill` cachix cache.

Both are required status checks. The pnpm job is the only one of the five that uses a `strategy.matrix`, which is why its check context carries the node version; **bumping that version renames the check**, so the branch protection contexts have to change in the same breath or `master` silently stops being gated.

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

| Rule                      | Setting                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| Pull request required     | yes, 0 approvals (stale reviews dismissed)                                     |
| Required status checks    | `Linux (pnpm) (24.x)`, `Linux (Nix flake)`, strict (branch must be up to date) |
| Linear history            | required                                                                       |
| Conversation resolution   | required                                                                       |
| Force pushes / deletions  | blocked                                                                        |
| Applies to administrators | yes (no bypass)                                                                |

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

- **Tabs, width 4, 140 columns, single quotes, semicolons, and line breaks mostly yours.** `dprint.json` is the authority and `.dir-locals.el` matches it for Emacs. dprint wraps only a line longer than 140 columns; otherwise it keeps the layout it is given (`preferSingleLine: false`): a construct whose first element starts on a new line stays multi-line even when it would fit on one, and one that does not stays on one line. So to break a construct across lines, put a line break after its opening bracket. Its TypeScript, JSON and Markdown plugins come from the npm registry, pinned by the lockfile, rather than from dprint's default plugin URLs, so formatting needs no network. `excludes` holds `test/data` (the corpus is hbt-data's to format). There is no YAML or HTML plugin, so `.github` and `packages/hbt/test/stubs/index.html` are not formatted - which for `.github` is deliberate, since the workflows are copied from the four sibling repos and should not diverge from them.
- **Prefer an existing config's own mechanism to a new config file.** Keeping the compiled tests out of the published package was first attempted here as a `tsconfig.build.json` / `tsconfig.test.json` split and rejected; the one-line answer was a negated pattern in `package.json`'s existing `files` field, for an identical tarball, until moving the tests out of `src/` made even that unnecessary. pnpm, tsc and dprint each have a field or ignore file for most of these cases. If a split is genuinely needed, say why and ask first - as the per-environment tsconfig projects were, in henrytill/hbt-js#27, because one `compilerOptions` cannot give the library and the CLI different `types`.
- **There is no linter.** The author's other TypeScript projects ([bits-js](https://github.com/henrytill/bits-js), [incr](https://github.com/henrytill/incr)) run eslint; this one does not yet, so `tsc` under `strictest` is the whole static check. **It covers the `.mjs` scripts too**: `scripts/build.mjs`, `scripts/test-browser.mjs` and `scripts/clean.mjs` start with `// @ts-check`, and `scripts/tsconfig.json`'s `allowJs` brings them into the build, so a script gets the same strictness as the library. Give a new script the same header and put it in `scripts/` beside them, where the project's `*.mjs` picks it up. The project sets `noEmit`, since node runs the scripts as they are.
- **A type's functions are `mkFoo` and `fooVerb`, exported flat**: `mkUrl`, `mkTime`, `mkEntity` build; `entityEquals`, `entityMerge` operate. `src/index.ts` groups each module as a namespace (`export * as entity`), which still tree-shakes because it is a static namespace of real exports. Do not group a type's functions inside a module, as an `export namespace` or a const object: neither tree-shakes property by property (checked with esbuild), which is why both were rejected. Nine schemes were tried before this one, recorded in PR #2; no TypeScript style guide prescribes one, so do not reopen the question on style grounds. Two related findings from the same round: a TypeScript overload cannot span same-named exports from two files ("Duplicate identifier"), so `mkTime` is one overloaded function over seconds and `Date`; and `Collection` uses `#private` fields deliberately, for privacy at runtime, against the Google guide's preference for `private`.
- **Third-party modules are imported as namespaces**: `import * as yaml from 'yaml'` and `yaml.stringify(...)`, never `import { stringify } from 'yaml'`, so a bare function name always means one of this repo's own. Relative imports stay named (`import { mkEntity } from './entity.js'`).
- **`.js` extensions on relative imports**, as ESM and `verbatimModuleSyntax` require: `from './entity.js'`, even though the file is `entity.ts`.
- **Comments explain the bug or the decision that motivated the code.** The doc comments here name the sibling implementation and the test or issue that settled a rule; this is deliberate and worth continuing, since it stops a later simplification from quietly reintroducing a fixed bug or diverging from the other four.
- **Optional fields are omitted, not nulled**, on the wire and in the type. Build them with the `...(x !== undefined && { x })` spread that `entityMerge` uses, which `exactOptionalPropertyTypes` is what makes necessary.
