# hbt-js

## REMEMBER

**Use GitHub MCP for all GitHub queries** (instead of fetching webpages)

**Never work directly on `master`** - branch first, land via PR (see [Git Workflow](#git-workflow))

**Run `npm run fmt` before every commit** - prettier is not a CI check, so a misformatted file lands silently and churns the next diff

**Every fixture is waived** - the CLI is still a stub, so conformance reports `xfail` across the board and says nothing about the library (see [Testing](#testing))

**Fixtures live in a submodule shared with four other implementations** - changing one is a cross-language decision (see [Testing](#testing))

## Overview

A TypeScript implementation of hbt, a bookmark and document collection tool, developed differentially alongside:

- [hbt-rs](https://github.com/henrytill/hbt-rs) (Rust)
- [hbt-go](https://github.com/henrytill/hbt-go) (Go)
- [hbt-ocaml](https://github.com/henrytill/hbt-ocaml) (OCaml)
- [hbt-hs](https://github.com/henrytill/hbt-hs) (Haskell)

The tool reads bookmarks from Pinboard exports (JSON/XML), Netscape bookmark HTML, and Markdown, merges them into a collection keyed by URL, and writes the result as YAML or HTML.

**This is the newest and least finished of the five.** The data model - `Entity`, `Collection`, and the merge - is written and tested. Nothing else is: there are no parsers, no formatters, and no CLI. `src/cli.ts` is one line that prints `hbt`, and `bin/hbt` points at its compiled form - it ignores every flag, `--version` included, and exits 0. Read any statement about parsers or formats below as describing what the other four do and what this one is being built toward.

The implementations share a wire format and a fixture corpus, so a semantic question - what merging two entities that share a timestamp should produce, say - gets settled once and pinned in [hbt-data](https://github.com/henrytill/hbt-data), then implemented in each. Issues are filed as companions across the repos; the discussion usually lives in whichever one hit it first. **hbt-rs's `AGENTS.md` carries the long form of the merge rules**, each with the issue that settled it; this file states what the code here does and does not restate the arguments.

## Core Principles

- **Typecheck early & often**: types are not only a correctness check, they guide the design. `tsconfig.json` turns on `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. Keep them on; `exactOptionalPropertyTypes` in particular is what makes "absent" and "present and `undefined`" different things, which the optional timestamps depend on.
- **Branded types over bare primitives**: `Url`, `Name`, `Label`, `Extended` and `Time` are all `Brand<...>` aliases over `string` or `number`, so the checker catches field mix-ups the way hbt-rs's newtypes and hbt-go's named types do. Follow the pattern when adding a field. The brand is a `declare const brand: unique symbol`, so it exists only at the type level and costs nothing at runtime.
- **Make illegal states unrepresentable**: where TypeScript cannot, constrain construction to one place. `mkEntity` is the only thing that builds an `Entity`; `mkName`, `mkLabel` and `mkExtended` are the only things that build their brands, and each refuses the empty string.
- **The library runs in a browser too**: hbt-js starts as a CLI but is meant to run in a browser as well, so everything except `src/cli.ts` stays free of Node APIs (`fs`, `process`, `path`, `Buffer`). The library takes and returns strings; reading files, parsing arguments and choosing a format from an extension belong to the CLI. A parser that needs a platform facility, such as a `DOMParser` for HTML and XML, takes it as an argument, so the browser passes its own and the CLI supplies one.
- **No recursion**: avoid recursive calls over user-provided data, which can nest arbitrarily deeply. The parsers in the other four all walk an explicit stack; the ones here should too when they land.

## Layout

A single npm package, ESM (`"type": "module"`), bundled by esbuild from `src/` to `dist/`. `tsc` only typechecks (`noEmit`), as the `prebuild` script; `build.mjs` then writes every output:

| File                | Role                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `src/entity.ts`     | The branded types, `Entity`, `mkEntity`, `entityEquals`, `entityMerge`, `ParseError`                |
| `src/collection.ts` | `Id` and `Collection` - the graph, the URL index, `upsert`, `updateLabels`                          |
| `src/index.ts`      | The library's entry point: re-exports the modules above                                             |
| `src/cli.ts`        | The CLI entry point, and the only module that may use Node APIs. Currently a stub                   |
| `src/*.test.ts`     | Unit tests, beside the code they cover                                                              |
| `test/browser/`     | Stand-ins for `node:test` and `node:assert/strict`, the test page, and `run.mjs`, which runs it     |
| `test/data/`        | The [hbt-data](https://github.com/henrytill/hbt-data) submodule: corpus, conformance harness, flake |

- `dist/cli.js` - the CLI, for node.
- `dist/browser/hbt.js` - the library, for the browser. Nothing consumes it yet; it is built so that a dependency reaching for a Node builtin fails the build (`Could not resolve "fs"`) the day it is added, not the day a browser front end is. **Choose dependencies that bundle for both platforms.**
- `dist/test/node/` - one bundle per test file.
- `dist/test/browser/` - every test file in one classic script, beside the page that loads it.

Every bundle carries its dependencies, and esbuild resolves each package's `browser`/`node` export condition by platform, so the node and browser outputs may contain different builds of the same dependency. `package.json` excludes `dist/test` from `files`, so the tests are built but not published.

### `entity.ts`

`Entity` is a `type`, not a class: a readonly record whose multi-valued fields (`updatedAt`, `names`, `labels`, `extended`) are `ReadonlySet` and whose optional ones (`createdAt`, `shared`, `toRead`, `isFeed`, `lastVisitedAt`) are absent rather than null when unset.

- **`mkEntity` holds the normal form.** An update never repeats `createdAt`; an update strictly _below_ `createdAt` is a different thing and stays. Every construction goes through it, so the rule holds by construction rather than by a normalizing pass. hbt-rs asserts it on serialize and hbt-go calls `Normalize()` at the parse and decode boundaries - **this should grow the same check at the serialize and decode boundaries when they land**, since a decoded collection is input like any other.
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

## Testing

Two layers today: unit tests beside the code, run under node and again in a browser, and the conformance harness against the built CLI.

**Unit tests.** `node --test` over the _bundled_ tests, so `npm test` builds first (its `pretest` script):

```sh
npm test                                     # typecheck, build, then every dist/test/node/**/*.test.js
node --test dist/test/node/entity.test.js    # one file, after a build
```

They are the only thing actually covering this repo right now. Write them against the exported API rather than internals - `Id`'s owner is private precisely so that nothing, tests included, can reach around it.

**The same unit tests in a browser.** `build.mjs` bundles them a second time for the browser, with `node:test` and `node:assert/strict` aliased to the stand-ins in `test/browser/`, and `test/browser/run.mjs` loads the page in headless Chromium (`--dump-dom`) and reads the report the stand-in writes into it. It needs no Nix: any Chromium or Chrome will do.

```sh
npm run test:browser                                  # build, then run under `chromium` from PATH
CHROMIUM=/path/to/chrome npm run test:browser         # any other Chromium or Chrome binary
```

This is the run that shows the library behaves the same in both places, which matters most once a parser takes an injected `DOMParser`: node's tests get the CLI's, the browser's get the native one. The stand-ins implement only what the tests use - `describe`, `it`, and `ok`/`equal`/`notEqual`/`deepEqual`/`throws` with strict semantics. **A test that reaches for more (`before`, `mock`, `assert.match`) fails only in the browser** until the stand-in grows it; `deepEqual` throws on a built-in it does not know rather than calling two of them equal.

**Source maps.** esbuild writes one beside every bundle, but node reads them only under `--enable-source-maps`. `npm test` passes it, so a failure's stack names the line in `src/*.test.ts` rather than in the bundle. The browser report prints only each error's message, and `bin/hbt` does not pass the flag.

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
npm run build        # tsc (typecheck only), then build.mjs
npm test             # npm run build, then node --test
npm run test:browser # npm run build, then the tests in headless Chromium
npm run fmt          # prettier --write .
```

The dev shell's `linkNodeModulesHook` links `node_modules` from the lockfile, so **a plain `npm install` inside it writes a real `node_modules` over the link**. Add a dependency with `--package-lock-only`, which updates `package.json` and `package-lock.json` without installing anything:

```sh
npm install --package-lock-only --save-dev <dep>   # or without --save-dev for a runtime dep
```

**That command does write one file into the tree: `node_modules/.package-lock.json`, replacing the hook's link with a regular file.** The hook then prints `cowardly refusing to link` and leaves every package, the new one included, unlinked. Delete that file, then leave and re-enter the shell, so the hook relinks from the new lockfile. The lockfile is the input Nix builds from - `importNpmLock` reads it - so a dependency change that does not reach it builds against the old tree.

### Nix

```sh
nix flake check -L   # the conformance and browser checks
nix build -L         # the hbt package
```

`self.submodules = true` is set, so flake builds see `test/data/`. The package is a `buildNpmPackage` using `importNpmLock`; `bin/hbt` in the result is a generated wrapper that invokes node on `dist/cli.js`. **`dist/cli.js` has no shebang**, so outside Nix it is not directly executable - anything that wants to spawn the CLI without Nix needs `node dist/cli.js`, or the file needs a `#!/usr/bin/env node` line.

**The CLI will need `--version` to report the revision.** The other four bake the commit into the binary and print it (`hbt 0.1.0 (7e16a14)` from hbt-rs, `hbt 0.1.0-21ebc53` from hbt-go); hbt-analysis's benchmark harness reads that to record which build produced a measurement, and a binary that answers `hbt` to every flag records nothing. hbt-rs does it with `HBT_COMMIT_HASH` from `self.shortRev or self.dirtyShortRev` in its flake - note that reading those is also what forces hbt-analysis to use `git+file:` inputs rather than `path:`, so adding it here has that consequence upstream.

A `github:` flake reference carries no submodules, so it lacks the `hbt-data` input and `nix flake check` fails on it; use `git+https://github.com/henrytill/hbt-js?submodules=1` or a checkout.

## CI

`.github/workflows/ci.yml` runs on pushes and PRs to `master`, with no path filter:

- **Linux (npm) (24.x)** - `npm ci`, `npm run build`, `npm test`, on node 24 with an npm cache.
- **Linux (Nix flake)** - `nix flake check -L` (conformance, and the unit tests in headless Chromium) and `nix build -L`, through the `henrytill` cachix cache.

Both are required status checks. The npm job is the only one of the five that uses a `strategy.matrix`, which is why its check context carries the node version; **bumping that version renames the check**, so the branch protection contexts have to change in the same breath or `master` silently stops being gated.

**Prettier runs nowhere in CI**, so formatting is on you - see REMEMBER. Two other workflows: `zizmor.yml` (Actions security scan, path-filtered to `.github/**` plus a weekly cron) and `update.yml` (monthly flake lock bump).

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

- **Tabs, width 4, 140 columns, single quotes, semicolons.** `.prettierrc` is the authority and `.dir-locals.el` matches it for Emacs. `.prettierignore` holds `test/data` (the corpus is hbt-data's to format) and `.github` (prettier reflows YAML to 4-space indentation with single-quoted strings, which would make these workflows diverge from the four sibling repos they are copied from).
- **Prefer an existing config's own mechanism to a new config file.** Keeping the compiled tests out of the published package was first attempted here as a `tsconfig.build.json` / `tsconfig.test.json` split and rejected; the one-line answer was a negated pattern in `package.json`'s existing `files` field, for an identical tarball. npm, tsc and prettier each have a field or ignore file for most of these cases. If a split is genuinely needed, say why and ask first.
- **There is no linter.** The author's other TypeScript projects ([bits-js](https://github.com/henrytill/bits-js), [incr](https://github.com/henrytill/incr)) run eslint; this one does not yet, so `tsc` under `strict` is the whole static check.
- **`.js` extensions on relative imports**, as ESM and `verbatimModuleSyntax` require: `from './entity.js'`, even though the file is `entity.ts`.
- **Comments explain the bug or the decision that motivated the code.** The doc comments here name the sibling implementation and the test or issue that settled a rule; this is deliberate and worth continuing, since it stops a later simplification from quietly reintroducing a fixed bug or diverging from the other four.
- **Optional fields are omitted, not nulled**, on the wire and in the type. Build them with the `...(x !== undefined && { x })` spread that `entityMerge` uses, which `exactOptionalPropertyTypes` is what makes necessary.
