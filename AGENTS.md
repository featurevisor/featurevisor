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

CI runs install, build, lint, typecheck and test. `make check` adds the slower
checks listed in the Makefile, and runs before publishing. Build packages
before checks that import their output, and never rebuild one while such a
check runs.

## Where things live

- Packages live under packages, and example projects under examples. The
  default init scaffold is examples/example-yml.
- Read [the runtime contract](conformance/runtime.md) and
  [fixture guide](conformance/README.md) before changing evaluation, datafiles
  or fixtures.
- packages/expressions holds condition expressions, which Core expands into
  trees as it reads a project. A command that writes definitions must keep
  the expressions authors wrote.
- `fmt`, `migrate` and `convert` live in packages/core/src and share
  packages/core/src/rewrite with promote. After changing the house style in
  packages/core/src/formatter/style.ts, run `make build` and
  `make fmt-examples`, since every example must stay formatted.
- Catalog lives in packages/catalog. Visible changes also run
  `make test-catalog-browser`.

## Contribution boundaries

Preserve unrelated edits. Keep generated files, secrets and personal filesystem
paths out of commits. Do not change published APIs or evaluation semantics
incidentally while refactoring internals. Add regressions for behaviour changes.

Public documentation is maintained at
[featurevisor.com](https://featurevisor.com/docs/). Skills live in skills.
