# CLI

Full docs: <https://featurevisor.com/docs/cli/>

Inside a project with `@featurevisor/cli` installed, run `npx featurevisor <command>`. The CLI finds `featurevisor.config.js` by walking up from the current directory. `--root-directory-path=<path>` selects another project. `npx featurevisor <command> --help` lists a command's options.

Built in commands reject unknown options and extra arguments, so an error usually means a misspelled flag. Write options in kebab case, such as `--key-pattern`, as the docs do. With `--json`, errors are structured too.

Examples omit environments. When the project configures them, add `--environment=<name>` to `evaluate`, `benchmark`, `assess-distribution` and `build --print`. In a Sets project, add `--set=<set>`, which `--json` output requires.

## Setup

```bash
npx @featurevisor/cli@latest init
npx @featurevisor/cli@latest init --example=with-environments
npm install
```

| `--example=`        | Project                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `yml` (default)     | YAML, no environments, an `all` target without selectors          |
| `with-environments` | YAML with `staging` and `production` environment keyed rules      |
| `json`              | JSON definitions, with `staging` and `production` environments    |
| `toml`              | a custom TOML parser, with `staging` and `production`             |
| `no-environments`   | the same shape as the default, stated explicitly                  |
| `environments`      | Sets as release lanes, promoted from dev to staging to production |
| `sets`              | Sets as independent surfaces, `storefront` and `admin`            |
| `test-environments` | release lanes with more test examples                             |
| `targets`           | many target and tag selector shapes                               |
| `namespace-slash`   | `namespaceCharacter: "/"`                                         |
| `composition`       | composed global variables in every form                           |

`environments` means Sets as lanes, not environment keyed rules. For staging and production rules in one tree, use `with-environments`. Read [sets-promotions.md](sets-promotions.md) before choosing a Sets example.

`init` never overwrites existing files. When entries would collide, it stops and lists them.

## lint

```bash
npx featurevisor lint
npx featurevisor lint --json --pretty
npx featurevisor lint --entity-type=feature
npx featurevisor lint --key-pattern="checkout"
```

Validates every definition and spec: schemas, references, types, operators, formats, cycles, weights, mutations and test expectations. Entity types: `feature`, `segment`, `attribute`, `schema`, `target`, `variable`, `test`, `scenario`. `--key-pattern` is a case sensitive regular expression and is not anchored, in `lint`, `test` and `list` alike. Match the key's case exactly, which also works with CLI 4.0.0, where `test` and `list` ignored case.

With `--json`, the report is `{ "errors": [...], "warnings": [...] }`, and each entry has `filePath`, `entityType`, `key`, `message`, `path` and `code`:

```json
{
  "filePath": "segments/old.yml",
  "entityType": "segment",
  "key": "old",
  "message": "when operator is \"semverGreaterThan\", value must be a version the operators can compare, such as 5.5.0, 5.5 or v5.5.0",
  "path": ["conditions", 2, "value"],
  "code": "custom"
}
```

Messages usually state the fix, for example `Replace segments with conditions` or `"checkout" is a feature: use { feature: checkout }`. After fixing, run lint again: some errors only surface once earlier ones in the same file are fixed.

Warnings do not fail lint. The common ones: `context_value_mismatch` (a test context does not fit an attribute), `dependency_depth` (a long dependency chain), `deprecated_reference` (an active definition uses a deprecated one), and the [composition warnings](global-variables.md#composition-warnings).

`--v3-mutation-order` shows values that change because v4 applies mutations in authored order. It is for upgrades from v3.

## fmt

```bash
npx featurevisor fmt
npx featurevisor fmt --check
npx featurevisor fmt --diff
npx featurevisor fmt features/checkout.yml segments
npx featurevisor fmt --check --since=origin/main
```

Formats every definition and spec in one house style, with no options: a blank line between top level keys, rules, force entries, global variable overrides, the environments that group them, and assertions, Featurevisor's own keys in a fixed order, block lists, quotes only where needed, and comments kept with the key below them. It never changes what a definition means, and the datafiles a build writes stay byte identical. After editing definitions, run it on the files you edited, so a project that is not formatted yet gets no changes beyond yours.

`--check` writes nothing and exits with 1 when a file needs formatting, for CI. Errors, such as a file that does not parse, exit with 2. `--diff` prints the changes as a unified diff and writes nothing. Add `--check` to it to fail as well. File and directory paths, `--entity-type` and `--key-pattern` narrow the files, as in `lint`, and `--since=<git ref>` keeps the files changed since HEAD left that reference, uncommitted and untracked ones too. `--stdin-filepath=<path>` formats text from stdin as that file and prints it, for editors. A file whose top comments include `# featurevisor-ignore` is left as written, and so is a line ending in `# featurevisor-ignore-line`. Blank lines the author wrote between entries stay, one at most. In a project with Sets, run it without `--set` so every set is formatted together. A file that does not parse is reported and left as it is. Each parser lays out its own files: JSON gets the key order and blank lines, and a custom parser takes part through an optional `format` function ([custom-parsers.md](custom-parsers.md)). Without one, `fmt` leaves its files as they are. `promote` does not format the files it writes, so run `fmt` after a promotion when `--check` reports files.

## migrate

```bash
npx featurevisor migrate --diff
npx featurevisor migrate
npx featurevisor migrate --check
```

Rewrites a v3 project's definitions and specs for v4, run once after installing the v4 CLI. It converts what has one right answer, as [upgrading-to-v4.md](upgrading-to-v4.md) lists, keeps comments, line endings and every line it does not change, and lists what needs a person under "Needs you". It writes files, so show `--diff` first and run it on the user's go ahead. `--check` writes nothing and exits with 1 while anything is left. It exits with 2, writing nothing, while Groups remain or a custom parser has no `stringify`. It needs no project configuration v4 can load, so it runs before anything else works.

## convert

```bash
npx featurevisor convert --to=environments
npx featurevisor convert --to=environments --environments=dev,production --apply
npx featurevisor convert --to=sets --apply
npx featurevisor convert --to=flat --keep=production --apply
```

Changes a project's shape between `flat` (no environments and no sets), `environments` and `sets`, rewriting definitions, specs, state files and `featurevisor.config.js`, and keeping comments and every line it does not change. Without `--apply` it previews and writes nothing. Before writing, it converts a temporary copy, lints and tests both, and builds both: every feature and global variable must build byte identical in each environment or set, or nothing is written.

- From environments to sets, each environment becomes a set with a copy of the attributes, segments, schemas and targets, each feature keeps only that environment's rules (`rules: []` where it had none), and `promotionFlows` follows the order of `environments`. Datafile paths stay the same, so only `--environment=` in CI becomes `--set=`.
- From sets to environments, shared definitions must be equal in every set, and a global variable must be in every set. Otherwise it lists the conflicts and exits with 2. `--environments` reorders the lanes.
- From flat, `--environments` or `--sets` name the lanes, staging and production by default. Assertions that need an environment run in each through a `matrix`.
- To flat, `--keep` names the lane to keep, and the preview lists what the others lose.

A project with sets and environments together is refused. Exits with 0 after a preview or a conversion and 2 when it cannot convert. `--json` prints the plan and checks. Do not propose a conversion unprompted ([sets-promotions.md](sets-promotions.md#when-to-use-sets-and-when-not-to)).

## test

```bash
npx featurevisor test
npx featurevisor test --key-pattern="checkout"
npx featurevisor test --json --pretty
npx featurevisor test --case='<case id from a failure>'
npx featurevisor test --uncovered
npx featurevisor test --coverage
```

See [testing.md](testing.md#run) for every option, reading failures, and reruns.

## evaluate

```bash
npx featurevisor evaluate --feature=checkout --context='{"userId":"8f2a","country":"nl"}'
npx featurevisor evaluate --feature=checkout --context='{"userId":"8f2a","country":"nl"}' --explain
npx featurevisor evaluate --variable=supportEmail --context='{"country":"nl"}' --explain
npx featurevisor evaluate --feature=checkout --context='{"userId":"8f2a"}' --json --pretty
```

Builds the datafile in memory from the local project and evaluates it with the SDK. `--feature` reports the flag, the variation and every feature variable together. `--variable` evaluates a global variable. Pass one or the other, never both.

`--explain` adds why:

- the deciding force entry, rule or override, with its conditions
- a pass or fail probe for every leaf of root, force and rule conditions, keeping their `and`, `or` and `not` structure
- the bucket value and bucket key, such as `Bucket: 75177 / 100000 · key "u1.checkout"`
- for a composition, each member's source and value

The probes run beside the SDK result and are not a full execution trace. The SDK result stays authoritative. `--explain --json` has the complete evidence.

`evaluate` warns when the context does not fit declared attribute types or constraints, without changing the result. Unknown feature or variable keys fail with a spelling suggestion. Repeat `--target=<target>` to evaluate against specific target datafiles.

## diff

```bash
npx featurevisor diff
npx featurevisor diff --from=main --to=HEAD
npx featurevisor diff --from=HEAD --to=working-tree --json --pretty
```

Compares authored definitions between Git references, semantically:

```text
Comparing HEAD → working-tree

~ feature checkout
  Rules
    Rule "everyone" updated
      Rollout percentage: 10 → 25

+ variable maintenanceMode
  Definition added

1 added, 1 changed, 0 removed
```

- Without options it compares `HEAD` with the working tree when there are uncommitted changes, otherwise the current branch with the primary branch.
- Rules and overrides match by key, variations by value and variables by name, so inserting a rule is one addition rather than changes to every rule after it. Formatting, comments and key order are ignored.
- It reads definitions only. It does not evaluate, lint or build.

Use it to summarize your own changes for the user, and to review a branch.

## build

```bash
npx featurevisor build --no-state-files
npx featurevisor build --no-state-files --target=web
npx featurevisor build --print --pretty --feature=checkout
```

Bare `build` is for CI: it increments `.featurevisor/REVISION` and updates state files, which the deploying pipeline commits. Locally, always pass `--no-state-files`. See [building-datafiles.md](building-datafiles.md) for every option.

An `invalid_saved_allocation` error means a rule's saved variation ranges no longer fit. Restore state from the deployed revision, or deliberately rename the rule after reviewing who would switch variations. Never delete state as a quick fix.

## list

Always pass `--json` (and `--pretty` when reading it yourself). Select one kind:

```bash
npx featurevisor list --features --json --pretty
npx featurevisor list --segments --json
npx featurevisor list --attributes --json
npx featurevisor list --variables --json
npx featurevisor list --schemas --json
npx featurevisor list --targets --json
npx featurevisor list --tests --json
npx featurevisor list --scenarios --json
npx featurevisor list --datafiles --json
```

Feature filters combine with AND:

| Flag                                             | Keeps features                                              |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `--tag=<tag>`                                    | with the tag. Repeat for several                            |
| `--target=<target>`                              | selected by the target. Repeat for a union                  |
| `--variable=<key>`                               | declaring the feature variable                              |
| `--variation=<value>`                            | with the variation value                                    |
| `--with-variations`, `--without-variations`      | with or without variations                                  |
| `--with-variables`, `--without-variables`        | with or without feature variables                           |
| `--with-tests`, `--without-tests`                | referenced by any spec, or by none                          |
| `--enabled-in=<env>`, `--disabled-in=<env>`      | with a rule above 0%, or only 0% rules, in that environment |
| `--enabled`, `--disabled`                        | the same, in a project without environments                 |
| `--key-pattern=<regex>`, `--description=<regex>` | matching key or description                                 |
| `--archived=true`                                | archived ones, which are excluded by default                |

Use `--enabled-in` and `--disabled-in` in projects with environments, and `--enabled` and `--disabled` in projects without them. The CLI rejects the wrong pair, and unknown environment names, with `invalid_environment`. Force entries and root conditions are not considered, only rule percentages.

Segments, attributes, variables, schemas and targets take `--key-pattern`, `--description`, `--archived` and `--promotable`. Variables also take `--tag`, `--target` and `--with-tests` or `--without-tests`. `list --tests --apply-matrix --json` expands matrices into individual assertions. `list --datafiles` shows built datafiles with their sizes, so run `build` first.

## find-usage

```bash
npx featurevisor find-usage --segment=netherlands
npx featurevisor find-usage --attribute=country
npx featurevisor find-usage --feature=checkout
npx featurevisor find-usage --variable=supportEmail
npx featurevisor find-usage --unused-segments
npx featurevisor find-usage --unused-attributes
npx featurevisor find-usage --segment=netherlands --authors
```

One query per call. `--feature` lists the features and global variables referencing it. `--variable` lists what the variable depends on and what references it. `--authors` adds the Git authors of each file. Archived users are marked `(archived)`, and the unused lists ignore archived definitions on both sides. Run it before renaming, archiving or deleting anything. Application code is not part of the project, so search it separately.

## find-duplicate-segments

```bash
npx featurevisor find-duplicate-segments
```

Lists segments with identical conditions, candidates for consolidation.

## assess-distribution

```bash
npx featurevisor assess-distribution \
  --feature=checkout \
  --context='{"country":"de"}' \
  --populate-uuid=userId \
  --n=10000
```

Evaluates many generated users and reports how they split across enabled, disabled and variations. `--populate-uuid` fills an attribute with a fresh UUID per evaluation and can be repeated. Higher `--n` gives tighter numbers.

```text
Flag evaluations

  • enabled:    1,000   100.00%
  • disabled:       0     0.00%

Variation evaluations

  • treatment:    504    50.40%
  • control:      496    49.60%
```

Each run draws new IDs, so counts vary a little between runs. Use it to show someone that a split works before an experiment starts.

## benchmark

```bash
npx featurevisor benchmark --feature=checkout --context='{"userId":"8f2a"}' --n=1000
npx featurevisor benchmark --feature=checkout --variation --context='{"userId":"8f2a"}' --n=1000
npx featurevisor benchmark --feature=checkout --variable=paymentMethods --context='{"userId":"8f2a"}' --n=1000
npx featurevisor benchmark --variable=supportEmail --context='{"country":"nl"}' --n=1000
```

Measures SDK evaluation time.

## config and info

```bash
npx featurevisor config --json --pretty
npx featurevisor info
```

`config` prints the resolved configuration. `info` counts definitions, and with `--target` it reports per target datafile contents and sizes.

## generate-code

```bash
npx featurevisor generate-code --language typescript --out-dir ./src/featurevisor
npx featurevisor generate-code --language typescript --out-dir ./src/featurevisor --target=web --react
```

TypeScript bindings for features, global variables and context. See [code-generation.md](code-generation.md).

## promote (Sets only)

```bash
npx featurevisor promote --from=dev --to=staging
npx featurevisor promote --from=dev --to=staging --include-features="checkout"
npx featurevisor promote --from=dev --to=staging --apply
```

Previews by default. `--apply` writes destination files, the only command that edits definitions. See [sets-promotions.md](sets-promotions.md).

## catalog

```bash
npx featurevisor catalog
npx featurevisor catalog --port=4000
npx featurevisor catalog export
npx featurevisor catalog export --out-dir=./out --hash-router
npx featurevisor catalog serve
```

`catalog` exports, serves at `http://127.0.0.1:3000` and reloads on every saved change. When the project's remote is on GitHub, GitLab or Bitbucket, each definition has a Propose change link that opens it in the Git host's editor, which suits people who would rather not clone the repository. `catalog export` writes a static site to `catalog/` for hosting. `--hash-router` suits static hosts without a fallback to `index.html`. `--test-report=<file>` shows results from a saved `test --json` report. Set `catalogBasePath` in the configuration to host it under a path. Full docs: <https://featurevisor.com/docs/catalog/>.

## version

```bash
npx featurevisor --version
```

Prints the installed CLI and core versions. Check it first when a documented option is not recognized.

## Project plugins

Projects can add their own commands through `plugins` in `featurevisor.config.js`. If `npx featurevisor --help` shows commands not listed here, they are project plugins: read their source before running them, since a plugin can write files. See [plugins-datasource.md](plugins-datasource.md).
