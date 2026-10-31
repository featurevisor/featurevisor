# Working on Featurevisor

Featurevisor is a Git managed feature and configuration system. This monorepo
contains the TypeScript types, JavaScript SDK, Core, CLI, Catalog, framework
integrations, OpenFeature providers, skills and example projects.

## Setup and checks

Use Node.js 24 or newer and npm workspaces.

```sh
make install
make build
make test
make lint
make typecheck
make format
```

CI runs installation, build, lint, typechecks and tests only, to stay fast.
make check runs the same steps, then make test-extended for the slower checks:
compiled package consumers, browsers, CLI integration, JavaScript conformance,
editor schemas, release configuration and bundle sizes. Run make check locally
before publishing. The browser checks need a local Chromium compatible browser.
There are no Git commit hooks. make format formats examples and package sources. Lerna coordinates npm workspaces.
Package directories also expose their own
build, test and typecheck scripts. SDK and Core source lives under packages.
Internal projects under examples exercise supported authoring and CLI flows.

Build packages before testing compiled consumers. Do not rebuild a package
while another check imports output that the build replaces. Unit tests importing
workspace siblings should resolve their source through the test configuration.

## Project fixtures

The default init scaffold comes from examples/example-yml. It has no
environments and an unfiltered all Target. The with-environments scaffold
uses staging and production. The existing environments scaffold models
release lanes as Sets instead. Verify scaffold content through the init
archive path, not only by inspecting example files.

`featurevisor fmt` lays out definitions in one house style, in four layers:

- packages/core/src/formatter/style.ts is the house style: the indent, line
  endings, every key order, every blank line by name, whether the author's own
  blank lines stay, and the choices only one file format can express, such as
  YAML's quotes and JSON's line width. Every opinion lives there, and nothing
  in it can change a datafile. Its notes say which values keep Prettier
  leaving fmt's output alone, which examples.spec.ts checks on every example. To change the style,
  edit it, run `make build` and `make fmt-examples`, update style.spec.ts and
  the docs Formatting page, and note it in the release notes, since it fails
  users' `fmt --check` once they upgrade.
- layout.ts places each kind of object in a definition, so the style reaches
  the right maps and lists. It keeps the promise that formatting never changes
  a datafile: only objects the builder rebuilds key by key get a key order.
  examples.spec.ts proves it on every example, by building a copy in reverse
  house key order beside a formatted one and requiring the same bytes. It also
  requires every example to be formatted already.
- formatDefinition.ts does what is the same in every format: line endings, a
  byte order mark, the final newline, the `# featurevisor-ignore` comment that
  leaves a whole file alone, and the checks that values and comments (through
  the parser's optional `listComments`) survive and that a second pass changes
  nothing. Those checks run only on a file that changes, and an unchanged file
  is parsed once, by the built-in `format`, which reads it as `parse` does. An
  error `format` throws is the author's only when `parse` fails too.
  formatProject.ts runs it over every Set in one pass, or over the files
  changed since a Git reference (since.ts), or over source from stdin.
- The parser's optional `format` applies the layout and its own section of
  the style: packages/parsers/src/ymlFormat.ts all of it, including the
  `# featurevisor-ignore-line` comment, jsonFormat.ts the key order, indent
  and blank lines, laying out lists as Prettier does. A `format` may
  return undefined to leave a file as it is.

Only style.spec.ts pins the style's output. The other formatter tests hold
whatever style.ts says, so a change to the style fails nothing else. fmt is
separate from promote and every other write: those write files as the parser
does and never format them, except convert as described below. Promote merges
what `stringify` writes into the lines of the file it replaces, or for a new
file the file it came from, so comments, layout, line endings and the final
newline stay wherever a promotion changes nothing. The YAML writer matches a
changed list item to the old one with its `key`, so a rule or keyed override
keeps its comments when its values change. A list item without a key, such as
most test assertions, still loses them.
Prettier leaves example-json's definitions to fmt
(see .prettierignore), since that example sets a Prettier width of 40. fmt
exits with 1 when `--check` finds work and 2 on errors, as Prettier does, so
plugin handlers may return an exit code. Every example ships an .editorconfig
that a test keeps in step with style.ts.

fmt, migrate and convert each keep a small plugin object in their folder's
index.ts, whose handler requires run.ts, so the CLI loads a command's code only
when it runs, and Core's index exports none of them. What they share lives in
packages/core/src/rewrite, loaded the same way, and promote writes through it
too: lines.ts aligns lines, merges
a rendered change into a file's own lines, keeps line endings and checks that
a rewrite reads back (`rewriteFile`), diff.ts prints unified diffs, and
files.ts lists definition files by kind.

`featurevisor migrate` rewrites a v3 project for v4 in packages/core/src/migrate,
and only there. The CLI entry skips loading the configuration for it, since v4
rejects v3 settings. Selectors convert as
the SDK's normalize.ts reads v3 datafiles, which migrate.spec.ts checks against
the SDK directly. Changes are merged into each file's own lines, so a review
sees only what migration changed. It was verified on every example of v3.11.0.

`featurevisor convert` changes a project between environments, sets and
neither, in packages/core/src/convert, contained and lazily loaded as migrate
is. Both write through `rewriteFile`. Convert edits YAML documents whatever the
parser, so one set of edits serves JSON and custom parsers too. It formats a
converted file only when its source was already as fmt writes it, which is
the one exception to fmt staying out of other writes: without it, JSON would
lose fmt's blank lines. Before writing, check.ts converts a temporary copy,
lints and tests both and builds both, and every feature and variable must
build byte identical per lane. An environment's datafiles carry what any
environment's rules use and a set's only what it uses, so a segment may come
or go, as only the entries naming it read it, while a feature or variable may
only when another lane's datafile names it. Test matrices narrow to one lane on the way to sets and come back on the
way to environments. example-1 round trips with only aliases written out,
assertion order and comment placement changed, and the smaller examples come
back byte identical apart from how the configuration lists environments.

Attribute files belong directly in the configured attributes directory,
including within each Set. Nested files and dots in attribute names are
rejected with invalid_attribute_namespace. Do not silently filter these files
out during discovery. Nested context uses object properties instead. The
slash namespace example declares attributes/user.yml and reads user.id and
user.country from a nested user object, while other entity keys may use slash.

## Contracts and integration

Read [the runtime contract](conformance/runtime.md) and
[fixture guide](conformance/README.md) before changing evaluation, datafile
handling or portable fixtures. Native runners use the separate
[test execution protocol](conformance/test-execution.md).

Execute all applicable fixture cases and preserve historical fixture bytes.
A version constant or a passing fixture copy check alone does not verify a port.
Keep expected results independent of the current reference implementation.
Compare sdk-diagnostics as unordered lists while preserving duplicate counts.
Turning them into sets can hide an extra or missing diagnostic.

Jest tests importing workspace siblings must map their package names to source
entry points with moduleNameMapper. Stale cjs output can otherwise make tests
pass against an old build. Retain the provider tests' source resolution
assertions for both the SDK and shared provider core. Rebuild dependency output
before compiled integration checks.

Useful optional integration checks are:

```sh
make test-cli-integration
make check-conformance-fixtures
make test-runner-conformance RUNNERS="javascript go"
make test-mutation-conformance RUNNERS="javascript go"
```

Native checks expect sibling SDK repositories with their CLI runners built.
Example 1 is the broad integration project. Other examples cover compositions,
Sets, namespaces and optional environments. example-schema-v2 serves schema "2"
datafiles to @featurevisor/sdk 3.8 beside schema "4" targets. Core's schemaV2
specs evaluate it, example-targets and example-1 with that SDK, installed as the
root dev dependency featurevisor-sdk-3, against the v4 SDK. Keep that comparison
when changing the converter in packages/core/src/builder/schemaV2.ts.

## Catalog

Catalog export and React UI live in packages/catalog. Run its package tests
and typecheck after changes. Visible interactions also need the isolated
make test-catalog-browser suite. Keep Core supplied Target membership as the
authority and use the existing shared reference walker for dependencies.
Follow surrounding components and test both flat and configured projects.

## Contribution boundaries

Preserve unrelated edits. Keep generated files, secrets and personal filesystem
paths out of commits. Do not change published APIs or evaluation semantics
incidentally while refactoring internals. Add regressions for behaviour changes.

Public documentation is maintained at
[featurevisor.com](https://featurevisor.com/docs/). Skills live in skills.
Keep repository instructions focused on contributing here rather than private
release coordination, review history or local benchmark records.
