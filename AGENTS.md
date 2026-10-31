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

`fmt`, `migrate` and `convert` live in packages/core/src/formatter, migrate and
convert, and share packages/core/src/rewrite with promote. Each loads only when
its command runs. The house style is formatter/style.ts: after changing it, run
`make build` and `make fmt-examples` and update style.spec.ts, which alone pins
the output. examples.spec.ts requires every example to be formatted and to
build byte identical datafiles. No other write formats files, except convert
for a file that was formatted already.

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

## FEL

FEL expressions are strings in conditions, read by shape: `*` is everyone, a
string shaped like an entity key is a segment, and any other string is an
expression. packages/fel parses, compiles and prints them, and depends only on
@featurevisor/types. Core expands them when Datasource reads features,
segments and global variables, so the builder, tests, Catalog and every other
reader see condition trees. A command that writes definitions back must not
write those trees over authored FEL. Read with readAuthoredEntity, or restore
FEL with restoreAuthoredFel as promotion does. Lint reports expressions while
allowFEL is false, and maps problems inside an expression to the YAML file's
line and column. Every place a definition can hold conditions is listed once,
in datasource/conditionLocations.ts, which FEL expansion and allowedConditions
share. Core's builder/fel.spec.ts checks that Example 1 read as FEL builds
identical datafiles. examples/example-fel began as Example 1 written in FEL
and is now its own showcase, kept apart from Example 1. Give each expression
added there a spec that covers matches, near misses and missing values.

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
