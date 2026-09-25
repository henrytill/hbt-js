# hbt-js

## REMEMBER

**Use GitHub MCP for all GitHub queries** (instead of fetching webpages)

**Never work directly on `master`** - branch first, land via PR (see [Git Workflow](#git-workflow))

**Run `npm run fmt` before every commit** - dprint is not a CI check, so a misformatted file lands silently and churns the next diff

**Every fixture is waived** - the CLI is still a stub, so conformance reports `xfail` across the board and says nothing about the library (see [Testing](#testing))

**Fixtures live in a submodule shared with four other implementations** - changing one is a cross-language decision (see [Testing](#testing))

## Overview

A TypeScript implementation of hbt, a bookmark and document collection tool, developed differentially alongside:

- [hbt-rs](https://github.com/henrytill/hbt-rs) (Rust)
- [hbt-go](https://github.com/henrytill/hbt-go) (Go)
- [hbt-ocaml](https://github.com/henrytill/hbt-ocaml) (OCaml)
- [hbt-hs](https://github.com/henrytill/hbt-hs) (Haskell)

The tool reads bookmarks from Pinboard exports (JSON/XML), Netscape bookmark HTML, and Markdown, merges them into a collection keyed by URL, and writes the result as YAML or HTML.

**This is the newest and least finished of the five.** The data model - `Entity`, `Collection`, and the merge - is written and tested, and so are the YAML formatter and the Markdown parser. Nothing else is: there are no other parsers, no HTML formatter, and no CLI. `src/cli.ts` prints `hbt`, and `bin/hbt` points at its compiled form - it ignores every flag, `--version` included, and exits 0. Read any statement about parsers or formats below as describing what the other four do and what this one is being built toward.

The implementations share a wire format and a fixture corpus, so a semantic question - what merging two entities that share a timestamp should produce, say - gets settled once and pinned in [hbt-data](https://github.com/henrytill/hbt-data), then implemented in each. Issues are filed as companions across the repos; the discussion usually lives in whichever one hit it first. **hbt-rs's `AGENTS.md` carries the long form of the merge rules**, each with the issue that settled it; this file states what the code here does and does not restate the arguments.

## Plan

The order the rest is expected to land in, each step its own PR. It is provisional, not settled: revise it here when it changes, and mark a step done when it merges.

1. **Markdown parser**, on [markdown-it](https://github.com/markdown-it/markdown-it) rather than the [commonmark.js](https://github.com/commonmark/commonmark.js) first planned. **Done**: `src/markdown.ts`, which passes all 25 fixtures, though conformance cannot show it until the CLI lands.
2. **CLI shim** in `src/cli.ts`: arguments (`-t`, `--info`, the format from the extension) and file reading, kept out of the library. The harness calls `hbt -t yaml <input>`. `--version` belongs here too (see [Nix](#nix)).
3. **Pinboard JSON, then Pinboard XML, then Netscape HTML.** Remove waivers as fixtures pass, as [Testing](#testing) describes.

The HTML and XML parsers are written against the DOM API and take a `DOMParser` (see Core Principles). Which one the CLI supplies is open: [linkedom](https://github.com/WebReflection/linkedom) (lean) or [jsdom](https://github.com/jsdom/jsdom) (fidelity), chosen by running both against the fixtures. Netscape bookmark HTML is not well-formed XML (unclosed `<DT>` and `<p>`), so it needs a real HTML parser, and its fixtures are where the two are likeliest to differ from each other and from a browser. If injection proves awkward, the fallback is [parse5](https://github.com/inikulin/parse5) and [@xmldom/xmldom](https://github.com/xmldom/xmldom) imported by the library directly, which behave the same everywhere.

## Core Principles

- **Typecheck early & often**: types are not only a correctness check, they guide the design. `tsconfig.json` turns on `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. Keep them on; `exactOptionalPropertyTypes` in particular is what makes "absent" and "present and `undefined`" different things, which the optional timestamps depend on.
- **Branded types over bare primitives**: `Url`, `Name`, `Label`, `Extended` and `Time` are all `Brand<...>` aliases over `string` or `number`, so the checker catches field mix-ups the way hbt-rs's newtypes and hbt-go's named types do. Follow the pattern when adding a field. The brand is a `declare const brand: unique symbol`, so it exists only at the type level and costs nothing at runtime.
- **Make illegal states unrepresentable**: where TypeScript cannot, constrain construction to one place. `mkEntity` is the only thing that builds an `Entity`; `mkName`, `mkLabel` and `mkExtended` are the only things that build their brands, and each refuses the empty string.
- **The library runs in a browser too**: hbt-js starts as a CLI but is meant to run in a browser as well, so everything except `src/cli.ts` stays free of Node APIs (`fs`, `process`, `path`, `Buffer`). The library takes and returns strings; reading files, parsing arguments and choosing a format from an extension belong to the CLI. A parser that needs a platform facility, such as a `DOMParser` for HTML and XML, takes it as an argument, so the browser passes its own and the CLI supplies one.
  - **Nothing enforces this yet, and the plan is for `tsc` to.** `@tsconfig/node24` gives every file Node's types, the library's included, so `process.env` in `src/entity.ts` typechecks. The browser bundle rejects an import of `fs`, but esbuild leaves a global like `process` or `Buffer` alone, so that would build and then crash in a browser. Adding `DOM` to `lib` would make this worse, not better: every file would see both platforms. The plan is one set of environment types per part instead, as a tsconfig per part linked by project references and built with `tsc -b`: the library with neither (`types: []`, no `DOM`); the CLI, the unit tests and the `.mjs` scripts with `node`; `test/browser/*.ts` with the DOM types it declares by hand. An injected facility is then a small interface the library declares, the way `test/browser/test.ts` declares `document`, which the native `DOMParser` and the CLI's alike satisfy. **Do this when the first parser that takes a platform facility lands** - Pinboard XML, in the [Plan](#plan)'s order, since the Markdown parser needs none; check first that TypeScript 7's `tsc -b` handles it.
- **No recursion**: avoid recursive calls over user-provided data, which can nest arbitrarily deeply. The parsers in the other four all walk an explicit stack; the ones here should too when they land. A dependency counts: markdown-it's block parser recurses once per level of nesting, so `src/markdown.ts` bounds it and refuses a document past the bound (see [below](#markdownts)).

## Layout

A single npm package, ESM (`"type": "module"`), built from `src/` to `dist/` twice over: `tsc` writes everything that runs under node - the library and the CLI - unbundled, as the `prebuild` script, and `build.mjs` then uses esbuild to write the browser bundles.

| File                  | Role                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/entity.ts`       | The branded types, `Entity`, `mkEntity`, `entityEquals`, `entityMerge`, `ParseError`                                |
| `src/whatwg-url.d.ts` | Types for the one whatwg-url module `mkUrl` imports, which ships none                                               |
| `src/collection.ts`   | `Id` and `Collection` - the graph, the URL index, `upsert`, `updateLabels`                                          |
| `src/yaml.ts`         | `formatYaml` - a `Collection` as `collection.schema.json` describes it                                              |
| `src/markdown.ts`     | `parseMarkdown` - a Markdown document as a `Collection`                                                             |
| `src/index.ts`        | The library's entry point: re-exports each module above as a namespace (`entity`, `collection`, `yaml`, `markdown`) |
| `src/cli.ts`          | The CLI entry point, and the only module that may use Node APIs. Currently a stub                                   |
| `src/*.test.ts`       | Unit tests, beside the code they cover                                                                              |
| `test/browser/`       | Stand-ins for `node:test` and `node:assert/strict`, the test page, and `run.mjs`, which runs it                     |
| `test/data/`          | The [hbt-data](https://github.com/henrytill/hbt-data) submodule: corpus, conformance harness, flake                 |

- `dist/tsc/src/` - the library from `tsc`: one `.js`, `.d.ts` and source map per module, and what `package.json`'s `exports` names, so consumers can import only `hbt` itself. It is unbundled, so its third-party imports stay imports: **a dependency the library uses is a `dependency`**, which the consumer installs along with its types, and the consumer's bundler picks that package's browser or node build. The extra `src/` is there because `tsc` also typechecks `test/browser/`, so its root is the repository. `tsc` also emits the tests here; `files` leaves them out.
- `dist/tsc/src/cli.js` - the CLI, from `tsc` too, and what `bin` names; `exports` does not, so consumers cannot import it. Unbundled, it runs the same modules consumers get, so conformance tests the shipped library. The cost is that **a dependency only the CLI uses is still a `dependency`**, installed by every consumer: prefer a light one, or load a heavy one with a dynamic `import()`.
- `dist/browser/hbt.js` - the library, bundled by esbuild for the browser. Nothing consumes it yet, and `files` leaves it out of the package: a browser app that installs `hbt` bundles `dist/tsc/`, and the only consumer the tarball copy would reach is a CDN. It is built so that a dependency reaching for a Node builtin fails the build (`Could not resolve "fs"`) the day it is added, not the day a browser front end is. If a CDN use case appears, publish it with an `exports` subpath (`"./browser"`) so it is a supported entry rather than a stray file. **Choose library dependencies that bundle for both platforms.**
- `dist/test/browser/` - every test file in one esbuild script, beside the page that loads it. Not published.

`dist/tsc/` is named for how it is built, not where it runs: a browser app that installs `hbt` and bundles it gets `dist/tsc/src/index.js` too, not `dist/browser/`, which is for loading directly with `<script type="module">`. Its third-party imports resolve by whoever loads it - node takes each dependency's `node` export condition, a browser bundler the `browser` one - so the browser and node may run different builds of the same dependency.

### `entity.ts`

`Entity` is a `type`, not a class: a readonly record whose multi-valued fields (`updatedAt`, `names`, `labels`, `extended`) are `ReadonlySet` and whose optional ones (`createdAt`, `shared`, `toRead`, `isFeed`, `lastVisitedAt`) are absent rather than null when unset.

- **`mkEntity` holds the normal form.** An update never repeats `createdAt`; an update strictly _below_ `createdAt` is a different thing and stays. Every construction goes through it, so the rule holds by construction rather than by a normalizing pass. hbt-rs asserts it on serialize and hbt-go calls `Normalize()` at the parse and decode boundaries - **this should grow the same check at the serialize and decode boundaries when they land**, since a decoded collection is input like any other.
- **`mkUrl` parses with whatwg-url, not the platform's `URL`.** The platforms disagree, and the result is the collection's key: Chromium 141 percent-encodes `|` in a path and `'` in userinfo and accepts hosts like `a b.com`; node 22 leaves `^` in a path where node 24 encodes it. whatwg-url gives the current spec's form everywhere, which the `mkUrl` tests pin. That is not quite hbt-rs's: its `url` crate (2.5.8) still leaves `^` in a path and a space before `?` or `#` in an opaque path raw, and keeps a `|` drive letter in `file:`. No fixture holds either form yet, so the difference is unpinned; settling it is hbt-data's call. **It imports `whatwg-url/lib/url-state-machine.js`, not the package**, because the entry loads webidl-conversions, which reads `SharedArrayBuffer.prototype` at load time and throws on any page that is not cross-origin isolated (jsdom/webidl-conversions#31). That module is not public API, and whatwg-url is **held at 15**: from 16 the parser pulls in @exodus/bytes' legacy encodings and the bundle more than doubles. Run `npm run test:browser` after any bump.
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

- **The sets are sorted, by code point.** The harness compares set-valued fields in order, and the order the other four agree on is hbt-rs's `BTreeSet` - UTF-8 byte order for strings, numeric for `updatedAt`. A JS `Set` iterates in insertion order and `Array.prototype.sort` compares UTF-16 code units, which differ from code points above U+D800; `compareCodePoints` is what closes that gap. Edges are not sorted: they keep the order they were added, as hbt-rs's `Vec` does.
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
- **Nesting is capped at 200 of markdown-it's levels**, 99 nested lists. Unbounded, its recursion overflows node's stack between 1000 and 2000 levels; at its preset's limit of 20 it silently drops the deeper content. Past the cap, `parseMarkdown` throws. hbt-rs has no limit.

Checked beyond the unit tests by running the corpus's Markdown fixtures through the harness with a scratch shim (all 25 pass), and by a differential fuzz against hbt-rs's binary over generated documents, which agreed on every one but those hitting the two differences above.

## Testing

Two layers today: unit tests beside the code, run under node and again in a browser, and the conformance harness against the built CLI.

**Unit tests.** `node --test` over the tests as `tsc` compiles them, beside the library they cover, so `npm test` builds first (its `pretest` script):

```sh
npm test                                     # build, then every dist/tsc/src/**/*.test.js
node --test dist/tsc/src/entity.test.js      # one file, after a build
```

They are the only thing actually covering this repo right now. Write them against the exported API rather than internals - `Id`'s owner is private precisely so that nothing, tests included, can reach around it.

**Stay on `node:test` and `node:assert`.** Do not add a test framework; if the tests come to need something more featureful, raise it with the maintainer first.

**The same unit tests in a browser.** `build.mjs` bundles them a second time for the browser, with `node:test` and `node:assert/strict` aliased to the stand-ins in `test/browser/`, and `test/browser/run.mjs` loads the page in headless Chromium (`--dump-dom`) and reads the report the stand-in writes into it. It needs no Nix: any Chromium or Chrome will do.

```sh
npm run test:browser                                  # build, then run under `chromium` from PATH
CHROMIUM=/path/to/chrome npm run test:browser         # any other Chromium or Chrome binary
```

This is the run that shows the library behaves the same in both places, which matters most once a parser takes an injected `DOMParser`: node's tests get the CLI's, the browser's get the native one. The stand-ins implement only what the tests use - `describe`, `it`, and `ok`/`equal`/`notEqual`/`deepEqual`/`throws` with strict semantics. **A test that reaches for more (`before`, `mock`, `assert.match`) fails only in the browser** until the stand-in grows it; `deepEqual` throws on a built-in it does not know rather than calling two of them equal.

**Source maps.** `tsc` and esbuild both write one beside every output, but node reads them only under `--enable-source-maps`. `npm test` passes it, so a failure's stack names the line in `src/*.test.ts` rather than in the compiled output. The browser report prints only each error's message, and `bin/hbt` does not pass the flag.

**Shared fixtures.** `test/data/` is a git submodule of [hbt-data](https://github.com/henrytill/hbt-data), consumed by all five implementations. Clone with `--recurse-submodules`, or run `git submodule update --init`. Changing a fixture is a cross-language decision: it will go red in the others until their fixes land.

**Never edit `test/data/` in place.** It is detached at a revision five repositories pin. Fixture and harness work belongs in an hbt-data checkout of its own, lands there first, and reaches this repo as a pointer bump. A missing or stale submodule shows up as mass failures rather than as a clear error.

**Conformance.** `test/data/` also carries hbt-data's conformance harness (henrytill/hbt-data#14), which runs every fixture through the built `hbt` and compares what the CLI writes. It is the `conformance` flake check, via hbt-data's exported `lib.check`; `test/data/` is also the `hbt-data` flake input (`path:./test/data`), so bumping the submodule needs no relock.

```sh
nix build -L .#checks.x86_64-linux.conformance    # or just nix flake check -L
```

**`conformance.waivers` at the repo root waives every fixture**, with the reason `stub`. The harness reports each as `XFAIL` and the check passes. This is the mechanism that lets a stub sit in the matrix rather than being excluded from it, and it is self-clearing: once a parser lands, the fixtures it satisfies report **`XPASS`**, which _fails_ the run until the waiver is removed. So the way to land a parser is to write it, watch conformance go red with `XPASS`, and delete those lines from `conformance.waivers` in the same commit. Do not pre-emptively remove waivers for work not yet done.

Three further rules about that file, each learned the expensive way:

- **A waiver's reason names the issue that removes it.** `stub` is the exception this repo gets while there is no CLI at all; a waiver added later should read `markdown/superseded_created_at # henrytill/hbt-js#N`.
- **A stale waiver fails the run**, "stale" meaning it names a fixture this corpus does not have - it does not merely warn. So a waiver and the `test/data` bump that brings in the fixture it waives **must be one commit**: the waiver is stale before the bump and the fixture fails after it, so neither is landable alone.
- **A corpus error is not waivable.** A malformed expectation file is hbt-data's failure, not this implementation's, and no waiver lets it ride along at exit 0.

**None of the other four implementations carries a `conformance.waivers` file** - they satisfy the corpus outright. This repo is the only one with waivers, and the file should shrink to nothing as the parsers land.

The harness's flags, what counts as a match, and its timezone policy are documented in `test/data/README.md`. Nothing pins `TZ`: the implementations are meant to be timezone-invariant, and the harness runs under the ambient zone so it can notice when one is not. `--tz` forces a zone when reproducing a failure.

## Development Commands

There is no system-wide toolchain: node, npm and the harness's Python come from the flake.

```sh
nix develop          # then work normally; linkNodeModulesHook links node_modules
npm run build        # tsc (the library), then build.mjs (the bundles)
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

`self.submodules = true` is set, so flake builds see `test/data/`. The package is a `buildNpmPackage` using `importNpmLock`; `bin/hbt` in the result is a generated wrapper that invokes node on `dist/tsc/src/cli.js`. `src/cli.ts` starts with `#!/usr/bin/env node`, which `tsc` keeps, so the `hbt` that a plain `npm install` links runs too.

**The CLI will need `--version` to report the revision.** The other four bake the commit into the binary and print it (`hbt 0.1.0 (7e16a14)` from hbt-rs, `hbt 0.1.0-21ebc53` from hbt-go); hbt-analysis's benchmark harness reads that to record which build produced a measurement, and a binary that answers `hbt` to every flag records nothing. hbt-rs does it with `HBT_COMMIT_HASH` from `self.shortRev or self.dirtyShortRev` in its flake - note that reading those is also what forces hbt-analysis to use `git+file:` inputs rather than `path:`, so adding it here has that consequence upstream.

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
- **Prefer an existing config's own mechanism to a new config file.** Keeping the compiled tests out of the published package was first attempted here as a `tsconfig.build.json` / `tsconfig.test.json` split and rejected; the one-line answer was a negated pattern in `package.json`'s existing `files` field, for an identical tarball. npm, tsc and dprint each have a field or ignore file for most of these cases. If a split is genuinely needed, say why and ask first.
- **There is no linter.** The author's other TypeScript projects ([bits-js](https://github.com/henrytill/bits-js), [incr](https://github.com/henrytill/incr)) run eslint; this one does not yet, so `tsc` under `strict` is the whole static check. **It covers the `.mjs` scripts too**: `build.mjs` and `test/browser/run.mjs` start with `// @ts-check`, and `allowJs` brings them into the program, so a script gets the same strictness as the library. Give a new script the same header, and add it to `include` if it lives outside `test/browser`. `tsc` also emits copies of them into `dist/tsc/`, which nothing runs or publishes.
- **A type's functions are `mkFoo` and `fooVerb`, exported flat**: `mkUrl`, `mkTime`, `mkEntity` build; `entityEquals`, `entityMerge` operate. `src/index.ts` groups each module as a namespace (`export * as entity`), which still tree-shakes because it is a static namespace of real exports. Do not group a type's functions inside a module, as an `export namespace` or a const object: neither tree-shakes property by property (checked with esbuild), which is why both were rejected. Nine schemes were tried before this one, recorded in PR #2; no TypeScript style guide prescribes one, so do not reopen the question on style grounds. Two related findings from the same round: a TypeScript overload cannot span same-named exports from two files ("Duplicate identifier"), so `mkTime` is one overloaded function over seconds and `Date`; and `Collection` uses `#private` fields deliberately, for privacy at runtime, against the Google guide's preference for `private`.
- **Third-party modules are imported as namespaces**: `import * as yaml from 'yaml'` and `yaml.stringify(...)`, never `import { stringify } from 'yaml'`, so a bare function name always means one of this repo's own. Relative imports stay named (`import { mkEntity } from './entity.js'`).
- **`.js` extensions on relative imports**, as ESM and `verbatimModuleSyntax` require: `from './entity.js'`, even though the file is `entity.ts`. The exception is a plain node script importing TypeScript source, which node runs by stripping its types: `run.mjs` imports `./test.ts`, and `rewriteRelativeImportExtensions` is on so that `tsc` accepts it. The `.ts` modules themselves keep `.js`.
- **Comments explain the bug or the decision that motivated the code.** The doc comments here name the sibling implementation and the test or issue that settled a rule; this is deliberate and worth continuing, since it stops a later simplification from quietly reintroducing a fixed bug or diverging from the other four.
- **Optional fields are omitted, not nulled**, on the wire and in the type. Build them with the `...(x !== undefined && { x })` spread that `entityMerge` uses, which `exactOptionalPropertyTypes` is what makes necessary.
