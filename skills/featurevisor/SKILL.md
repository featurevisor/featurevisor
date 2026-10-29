---
name: featurevisor
description: Author, test, query and integrate Featurevisor feature flags, A/B experiments and remote configuration. Use in Featurevisor projects (featurevisor.config.js) for features, segments, attributes, global variables and compositions, conditions, rollouts, test specs and scenarios, datafiles, targets, Sets and promotions, the Catalog and the CLI, and for explaining why a context gets a value. Also use for Featurevisor SDKs in JavaScript, React, Vue and other languages, OpenFeature providers, CLI plugins, and upgrades from v2 or v3. A generic feature flag request outside a Featurevisor project is not enough on its own.
---

# Featurevisor

You are helping the user with [Featurevisor](https://featurevisor.com), feature management through Git. A Featurevisor **project** is a repository of YAML (default) or JSON definitions. The CLI lints and tests them and builds static JSON **datafiles**, which applications evaluate locally through SDKs. Every task sits on one of two sides:

- **Project side**: authoring and querying definitions (features, segments, attributes, global variables, tests) and running the `featurevisor` CLI.
- **Application side**: loading datafiles and evaluating them through an SDK (`@featurevisor/sdk`, React, Vue or another language).

This skill covers both, for Featurevisor v4. The documentation index is at <https://featurevisor.com/llms.txt>, with the complete text at <https://featurevisor.com/llms-full.txt>. Fetch them when a topic is not covered by the references below.

## Know your audience

Engineers, product managers, marketers and people who describe what they want without knowing the YAML all use Featurevisor. Calibrate:

- **Translate intent.** "Turn on the banner for 10% of Dutch users" is a rollout rule. Do the mapping yourself, then report the result in their words: what changed, who is affected, and what happens next.
- **Routine changes:** raising a percentage, adding a rule above the catch-all, adding a feature, forcing a feature on for QA. Do these confidently.
- **Risky changes:** renaming a rule key, changing `bucketBy`, changing variation weights, lowering a percentage, archiving something still referenced. These move users between results. Say so plainly ("some users would lose the feature mid-session") and confirm before proceeding.
- **Close the loop.** After a change, say in one or two sentences what happens once it ships. For example: "once this merges and CI deploys the datafile, about 10% of users in the Netherlands see the banner, everyone else sees nothing."
- **Offer the Catalog** to anyone who wants to see the project rather than read YAML ([Visual review with the Catalog](#visual-review-with-the-catalog)).

## Orient yourself first

Examples in this skill use the default scaffold, which has no environments. When the project configures environments, add `--environment=<name>` to `evaluate`, `benchmark`, `assess-distribution` and `build --print`. A normal file build covers every environment.

### No project yet? Interview, then scaffold

Without a `featurevisor.config.js` in the working tree there is no Featurevisor project. If the user is in an **application repository**, this is SDK work: see [Application integration](#application-integration-sdks), and author definitions in the project repository, not here. If they want a new project, ask these first, because every file written afterwards depends on them:

1. **Environments?** The default has none, and rules are direct lists. `--example=with-environments` gives explicit `staging` and `production`.
2. **Sets?** Default **no**. Offer Sets only for independently reviewed trees: release lanes promoted from dev to staging to production, or unrelated surfaces such as a storefront and an admin. Read [sets-promotions.md](references/sets-promotions.md) first.
3. **Consumers?** One application can use the default `all` target, which has no selectors and includes every active definition. Several surfaces usually get tags such as `web`, `ios` and `android`, and a target per surface.
4. **File format?** YAML (default) or JSON.
5. **What identifies a user?** `userId`, `deviceId`, or both (`bucketBy: { or: [userId, deviceId] }`). Lint requires `bucketBy` on every feature, so this decides what each feature declares and which attributes come first.

Scaffold in an empty directory, in its own repository, separate from application code:

```bash
npx @featurevisor/cli@latest init
npm install
```

`--example=with-environments` gives environment keyed rules, `--example=environments` gives Sets as release lanes, and `--example=sets` gives independent surfaces. The [CLI setup table](references/cli.md#setup) lists every example. Then adjust `featurevisor.config.js` to the interview answers. [templates/example-project/](templates/example-project/) is a complete v4 project that passes lint and test, useful as a reference for how the pieces fit together.

### Existing project? Detect the version and shape before touching anything

Confirm the project has an installed `@featurevisor/cli` in its package manifest and lockfile, and with `npm ls @featurevisor/cli`. Then run the installed CLI from the project:

```bash
npx featurevisor --version
```

It must resolve the project's own binary. If it is missing or `npx` offers to download a package, stop and ask about restoring the project's locked dependencies. Do not install a remote CLI or upgrade dependencies just to detect a version.

- **4.x**: everything in this skill applies.
- **3.x**: v3 syntax differs. It uses `segments` in rules and `requiredFeatures` instead of unified `conditions`, and lacks variable conditions, compositions, `continue`, test `checks`, scenarios and several operators. Do not write v4 syntax into a v3 project. Stay within what [upgrading-to-v4.md](references/upgrading-to-v4.md#working-in-a-v3-project) lists as v3 syntax, and offer the upgrade when the request needs v4.
- **2.x**: shapes such as `scopes:`, an `environments/` directory or `createInstance` in application code. Offer [upgrading-to-v3.md](references/upgrading-to-v3.md) first.

**Consumers decide what you can publish.** v4 datafiles need v4 SDKs: v3 SDKs do not understand unified `conditions`, so rules stop matching. The datafile `schemaVersion` is informational and does not make an old SDK reject the file. Before introducing a runtime capability such as accumulating overrides or a newer operator, confirm the SDK version of every application consuming that datafile. Ask the user when this is unknown. Check each against the [SDK compatibility matrix](https://featurevisor.com/docs/sdks/compatibility/). Native version numbers differ, so do not assume every compatible SDK is numbered 4.x. CLI lint success alone does not establish runtime support. Test checks and scenarios require compatible CLI runners, which is a separate question from what consumers support.

Then read the configuration:

```bash
npx featurevisor config --json --pretty
npx featurevisor info
```

Four values change the **shape of everything you write**:

- `sets`: when `true`, every definition lives under `sets/<set>/` and commands take `--set`. Read [sets-promotions.md](references/sets-promotions.md) first.
- `environments`: when declared, feature `rules`, `force` and `expose`, and global variable `overrides`, are maps keyed by environment. Without it they are direct lists, and `expose` is a boolean or tag list.
- `parser`: author JSON for `"json"`, YAML for `"yml"` (default), or the configured custom format ([custom-parsers.md](references/custom-parsers.md)).
- `namespaceCharacter`: separator for keys from subdirectories. Default `.`, so `features/checkout/promo.yml` is `checkout.promo`. Some projects use `/`. Every reference must use the project's separator. Confirm against real keys with `npx featurevisor list --segments --json`.

Also note `tags` (every tag you use must be declared), `disallowOperators`, `allowedConditions`, and directory overrides such as `featuresDirectoryPath`. Then read one or two existing definitions to match local style before adding new ones.

## How Featurevisor fits together

| Definition      | Path                   | Purpose                                                                               |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| Attribute       | `attributes/<key>.yml` | Declares a context key and its type. Never namespaced.                                |
| Segment         | `segments/<key>.yml`   | Names an audience through `conditions`.                                               |
| Feature         | `features/<key>.yml`   | A flag, optional variations and feature variables, with rollout rules. Bucketed.      |
| Global variable | `variables/<key>.yml`  | A typed value with ordered overrides, or a `compose` of other values. Never bucketed. |
| Schema          | `schemas/<key>.yml`    | A reusable variable shape.                                                            |
| Target          | `targets/<key>.yml`    | Which definitions go into a datafile.                                                 |
| Test spec       | `tests/**/*.spec.yml`  | Feature, segment and variable assertions, and standalone scenarios.                   |

**Conditions** are one grammar used everywhere a definition selects or gates: segments, rules, force entries, root gates and overrides. A leaf compares an attribute, names a segment with a bare string, requires a feature, or compares a variable's value. A list means AND, and `and`, `or` and `not` groups nest. `'*'` matches everyone, but only as the whole expression.

```yaml
conditions:
  - attribute: country
    operator: equals
    value: nl
  - payingAccounts # a bare string is always a segment key
  - feature: liveChat # requires liveChat to be enabled
  - variable: maintenanceMode
    operator: equals
    value: false
```

**Evaluation order.** A feature's flag checks a sticky value, then whether the feature is in the datafile, then the first matching force entry, then root `conditions`, then the first rule whose conditions match, and finally that rule's percentage against the user's bucket. A percentage miss does not fall through to the next rule. A global variable checks a sticky value, then root `conditions`, then composition sources if any, then the first matching override (and later ones too when an override sets `continue: true`), then its default. Details: [features.md](references/features.md#evaluation-flow) and [global-variables.md](references/global-variables.md#evaluation-order).

## Core authoring rules

The references add depth, but they never override these.

### 1. Bucketing and rule keys are contracts

- `bucketBy` keeps each user's result stable while percentages change. Pick it once and never change it silently.
- Signed-in surfaces bucket by `userId`, anonymous ones by `deviceId`, mixed ones by `{ or: [userId, deviceId] }`. **Attribute names vary between projects**: read `attributes/` and ask which to use when it is not obvious. Never invent attribute names.
- Rule keys must be unique per list (per environment when configured) and must not change once users are bucketed. State files store each rule's variation ranges by key, so a rename reallocates them. Add a new rule instead of renaming.

### 2. First matching rule wins

Rules run top to bottom. Put narrow rules, such as a country at 100%, above the catch-all `conditions: '*'` rule. Once a rule matches, its percentage decides, and users above it do not fall through to later rules.

### 3. Reference only what exists

Confirm every attribute, segment, feature and variable you reference exists, or create it. Check `allowedConditions` in `featurevisor.config.js` too: it can limit which kinds of condition each location accepts, for example rules that only name segments ([conditions.md](references/conditions.md#allowed-condition-kinds)). Lint rejects unknown references. It also rejects, with `archived_reference`, any reference to an archived definition from a definition or spec that is not archived itself. An archived definition is dropped from datafiles, so a reference to it would silently stop matching, and under `not` would match everyone. Lint checks archived definitions for their shape only, so what they used can later change or go. A reference to a deprecated definition is a `deprecated_reference` warning. Run `npx featurevisor find-usage` before archiving, renaming or deleting anything, and prefer archiving to deleting: the archived file reserves the key.

### 4. Variation weights sum to 100

Each value is unique. `control` and `treatment` are conventions only. Lint rejects weights that do not sum to 100. With CLI 4.0.0 it did not, so check the sum yourself there: a short split builds once, then every later build fails with `Invalid saved variation allocation`. For mutually exclusive experiments, see [mutual-exclusion.md](references/mutual-exclusion.md).

### 5. Conditions stay portable across SDKs

Every SDK evaluates the same datafile, so lint enforces a portable subset:

- **Dates** (`before`, `after`) take a full ISO 8601 timestamp with a timezone, quoted: `'2026-11-27T00:00:00Z'`. Date-only and zoneless values fail lint. Both operators are strict.
- **Versions** (`semver*`) are quoted strings such as `'5.5'` or `'5.5.0'`, so YAML keeps them as text.
- **Regular expressions** (`matches`, `notMatches`) allow only the `g`, `i`, `m` and `s` flags, and reject every `(?` construct, including non-capturing `(?:…)`, plus backreferences and possessive quantifiers.
- Operators are checked against declared types. A `type: string` attribute with `format: date-time` only takes `before`, `after` and presence operators, and `in` takes a string list.

Details and lint messages: [operators.md](references/operators.md).

### 6. Match the project's shape

Environments, Sets, parser and namespace separator change how the same request is written. Templates use the default shape without environments. In a project with environments, put each `rules`, `force` or global `overrides` list under its environment key, and add `environment` to tests.

## Definition of done

Run this loop after every change. It is how you prove a change does what the user asked, and it gives you the evidence to report back.

1. **Format.** `npx featurevisor fmt <files you edited>` puts them in the house layout and key order, the way the user's teammates will expect to read them. It never changes what a definition means or what builds. Pass the files, so a project that is not formatted yet gets no changes beyond yours. Skip this step if the installed CLI has no `fmt` command.
2. **Lint.** `npx featurevisor lint` must pass. With `--json`, each error has `filePath`, `path`, `message` and `code`, so you can fix the exact field. Rerun after fixing: some errors only appear once earlier ones in the same file are gone.
3. **Specs.** Add or update the matching spec in the same change, then run `npx featurevisor test --key-pattern=<key>`. A failure prints a rerun command with an exact `--case`. `--json` gives each case's `errors` with `path`, `expected` and `actual`.
4. **Explain representative contexts.** `npx featurevisor evaluate --feature=<key> --context='{…}' --explain` shows the matched rule, the bucket, and pass or fail for each condition. Use one context inside the audience and one outside it.
5. **Coverage gaps.** `npx featurevisor test --uncovered` lists features and global variables without specs.
6. **Summarize the change.** `npx featurevisor diff` reports semantic changes against `HEAD`, such as `Rule "everyone" updated, Rollout percentage: 10 → 25`. Use it for your summary to the user.

`npx featurevisor build --no-state-files` confirms the datafiles build, and a running `npx featurevisor catalog` shows every change as it is saved.

## CLI: run freely, with two exceptions

Every CLI command is local and safe to run without asking, except:

- Bare `build` is a **CI command**. It increments `.featurevisor/REVISION` and rewrites state files, which only the deploying pipeline should commit. Locally, yours and the user's, always use `npx featurevisor build --no-state-files`. It writes the same datafiles.
- `promote --apply` (Sets only) **writes definition files**. Preview first, show the summary, then apply on the user's go ahead ([sets-promotions.md](references/sets-promotions.md)).

| Command                                                                                   | Purpose                                                              |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npx featurevisor config --json --pretty`                                                 | Project configuration                                                |
| `npx featurevisor info`                                                                   | Counts of every definition kind                                      |
| `npx featurevisor lint [--json]`                                                          | Validate definitions and specs                                       |
| `npx featurevisor fmt [--check]`                                                          | Format definitions in the house layout and key order                 |
| `npx featurevisor test [--key-pattern=…] [--json]`                                        | Run specs, with exact reruns through `--case`                        |
| `npx featurevisor test --uncovered` / `--coverage`                                        | Definitions without specs, and rules or overrides the specs selected |
| `npx featurevisor evaluate --feature=<k> --context='{…}' --explain`                       | Why a feature has its flag, variation and variables                  |
| `npx featurevisor evaluate --variable=<k> --context='{…}' --explain`                      | Why a global variable has its value                                  |
| `npx featurevisor diff [--from=<ref>] [--to=<ref>]`                                       | Semantic definition changes between Git references                   |
| `npx featurevisor list --features --json [filters]`                                       | Find features by tag, variable, variation, tests or target           |
| `npx featurevisor find-usage --segment=<k>` (or `--attribute`, `--feature`, `--variable`) | What references a definition, and what it depends on                 |
| `npx featurevisor find-usage --unused-segments` (or `--unused-attributes`)                | Dead definitions                                                     |
| `npx featurevisor find-duplicate-segments`                                                | Segments with identical conditions                                   |
| `npx featurevisor assess-distribution --feature=<k> --populate-uuid=userId --n=10000`     | Check that a rollout splits as intended                              |
| `npx featurevisor generate-code --language typescript --out-dir ./src`                    | Typed bindings for applications                                      |
| `npx featurevisor build --no-state-files`                                                 | Build datafiles without touching state                               |
| `npx featurevisor catalog`                                                                | Browsable read-only project UI with live reload                      |

**Prefer the CLI to reading YAML by hand** for questions such as "what uses segment X?" or "why is this feature off for me?". Its `--json` output is authoritative and parseable. Repeatable `--target=<target>` options evaluate, test or list against specific target datafiles. Full reference: [cli.md](references/cli.md). Question playbook: [querying.md](references/querying.md).

## When to load which reference

Read the matching file in full **before** authoring or debugging in that area. Do not rely on the summary here.

| Task                                                                                                        | Read                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Create or edit a feature: rules, force, variations, variables, root conditions, expose                      | [features.md](references/features.md)                                                                         |
| Write conditions: leaves, groups, dependencies, paths, evaluation order                                     | [conditions.md](references/conditions.md)                                                                     |
| Look up an operator, or a date, version or regex rule                                                       | [operators.md](references/operators.md)                                                                       |
| Write or change a segment                                                                                   | [segments.md](references/segments.md)                                                                         |
| Declare an attribute, its type, format and constraints                                                      | [attributes.md](references/attributes.md)                                                                     |
| Feature variables, types, reusable schemas and mutations                                                    | [variables-schemas.md](references/variables-schemas.md)                                                       |
| Global variables: overrides, nesting, accumulation, `compose`                                               | [global-variables.md](references/global-variables.md)                                                         |
| Mutually exclusive experiments and priority exclusion                                                       | [mutual-exclusion.md](references/mutual-exclusion.md)                                                         |
| Bucketing, `bucketBy`, state files, sticky values                                                           | [bucketing.md](references/bucketing.md)                                                                       |
| Tags, targets and namespaces                                                                                | [tags.md](references/tags.md), [targets.md](references/targets.md), [namespaces.md](references/namespaces.md) |
| `featurevisor.config.js`, environments, project options                                                     | [configuration.md](references/configuration.md)                                                               |
| Sets and promotions                                                                                         | [sets-promotions.md](references/sets-promotions.md)                                                           |
| JSON, TOML or another file format                                                                           | [custom-parsers.md](references/custom-parsers.md)                                                             |
| Build and deploy datafiles, CI                                                                              | [building-datafiles.md](references/building-datafiles.md)                                                     |
| Write specs, checks and scenarios, read reports                                                             | [testing.md](references/testing.md)                                                                           |
| Any CLI command and its options                                                                             | [cli.md](references/cli.md)                                                                                   |
| Answer questions about a project, debug an evaluation, browse the Catalog                                   | [querying.md](references/querying.md)                                                                         |
| JavaScript or TypeScript SDK in any runtime                                                                 | [sdk-javascript.md](references/sdk-javascript.md)                                                             |
| React or React Native                                                                                       | [sdk-react.md](references/sdk-react.md)                                                                       |
| Vue                                                                                                         | [sdk-vue.md](references/sdk-vue.md)                                                                           |
| Go, Python, Ruby, Java, Kotlin, Swift, PHP, Rust, Elixir, and running specs through them                    | [sdk-other-languages.md](references/sdk-other-languages.md)                                                   |
| OpenFeature providers                                                                                       | [openfeature.md](references/openfeature.md)                                                                   |
| Typed TypeScript bindings                                                                                   | [code-generation.md](references/code-generation.md)                                                           |
| Analytics and experiment exposure                                                                           | [tracking.md](references/tracking.md)                                                                         |
| Upgrade from v3 to v4                                                                                       | [upgrading-to-v4.md](references/upgrading-to-v4.md)                                                           |
| Upgrade from v2 to v3                                                                                       | [upgrading-to-v3.md](references/upgrading-to-v3.md)                                                           |
| Custom CLI commands, the datasource API, adapters                                                           | [plugins-datasource.md](references/plugins-datasource.md)                                                     |
| Named patterns: rollouts, A/B tests, kill switches, scheduled launches, early access, entitlements, cleanup | [recipes.md](references/recipes.md)                                                                           |
| Terminology                                                                                                 | [glossary.md](references/glossary.md)                                                                         |

### Templates

Starting files without environments. Replace placeholder keys, and create anything they reference, before linting.

| Shape                              | Template                                                                                                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attribute                          | [attribute.yml](templates/attribute.yml)                                                                                                                                                                                         |
| Segment                            | [segment.yml](templates/segment.yml), [segment-complex.yml](templates/segment-complex.yml)                                                                                                                                       |
| Feature flag                       | [feature.yml](templates/feature.yml)                                                                                                                                                                                             |
| A/B test                           | [feature-with-variations.yml](templates/feature-with-variations.yml)                                                                                                                                                             |
| Feature variables and overrides    | [feature-with-variables.yml](templates/feature-with-variables.yml)                                                                                                                                                               |
| Feature gated on other definitions | [feature-with-conditions.yml](templates/feature-with-conditions.yml)                                                                                                                                                             |
| Global variable                    | [variable.yml](templates/variable.yml), [variable-structured.yml](templates/variable-structured.yml)                                                                                                                             |
| Composition                        | [variable-composition.yml](templates/variable-composition.yml)                                                                                                                                                                   |
| Specs                              | [test-feature.spec.yml](templates/test-feature.spec.yml), [test-segment.spec.yml](templates/test-segment.spec.yml), [test-variable.spec.yml](templates/test-variable.spec.yml), [scenario.spec.yml](templates/scenario.spec.yml) |
| A whole project                    | [example-project/](templates/example-project/)                                                                                                                                                                                   |

## Common flows

### Starting a new project

1. Run the interview in [Orient yourself first](#no-project-yet-interview-then-scaffold).
2. Scaffold with the closest `init --example=…` and `npm install`.
3. Adjust `featurevisor.config.js` to the answers: `environments`, `tags`, `sets`, `parser`.
4. Replace the scaffolded definitions with the user's own, in dependency order: attributes, then segments, then features and global variables, then targets.
5. Run `npx featurevisor lint`, `npx featurevisor test` and `npx featurevisor build --no-state-files`.
6. Offer CI and CDN deployment ([building-datafiles.md](references/building-datafiles.md)) and `npx featurevisor catalog`.

### Adding a feature flag

1. Read existing `features/` to match naming and style.
2. Confirm the `bucketBy` attribute exists. Ask when several are plausible.
3. Create `features/<key>.yml` from [templates/feature.yml](templates/feature.yml). Keys become permanent identifiers in application code and analytics, so choose deliberately (camelCase by convention).
4. Create any missing segment from [templates/segment.yml](templates/segment.yml).
5. Add `tests/features/<key>.spec.yml` from [templates/test-feature.spec.yml](templates/test-feature.spec.yml), covering inside and outside each audience. Ask first when the project has no specs at all.
6. Run the [definition of done](#definition-of-done).

### A/B tests and variables

For variations read [features.md](references/features.md#variations) and start from [templates/feature-with-variations.yml](templates/feature-with-variations.yml). For feature variables read [variables-schemas.md](references/variables-schemas.md) and start from [templates/feature-with-variables.yml](templates/feature-with-variables.yml). Measuring results is application work: [tracking.md](references/tracking.md).

### Global variables and compositions

Ask whether a configurable value belongs to a feature or stands on its own. A support address, a retry limit or a CDN base URL belongs to no single flag, so it goes in `variables/<key>.yml` as a **global variable** ([templates/variable.yml](templates/variable.yml)). Feature variables suit values that follow a variation or need a percentage rollout. Global variables are never bucketed: the first matching override wins for everyone it matches.

`compose` builds a global variable from other evaluated values. `compose: supportEmail` is an alias, useful for renaming. A `compose` map assembles an object from flags, variations, feature variables and global variables, so an application reads one value instead of several ([templates/variable-composition.yml](templates/variable-composition.yml)). Read [global-variables.md](references/global-variables.md) before writing either. Applications read global variables with `getVariable(variableKey, context)`. Go, Rust and Elixir use `GetGlobalVariable` or `get_global_variable` ([sdk-other-languages.md](references/sdk-other-languages.md#global-variables)).

### Dependencies between definitions

A feature leaf (`{ feature: liveChat }`) requires another feature's flag or variation. A variable leaf requires a value, such as a kill switch `maintenanceMode` that must be `false`. Put them in root `conditions` to gate a whole feature or global variable, or in a rule or override to narrow it. An unmet root gate reports `conditions_unmet`. Lint rejects cycles. Read [conditions.md](references/conditions.md).

### Complex targeting

`and`, `or` and `not` nest everywhere conditions appear ([segments.md](references/segments.md), [templates/segment-complex.yml](templates/segment-complex.yml)). `not` negates the AND of its children: `not: [A, B]` means "not both". For "neither", write `not: [{ or: [A, B] }]`.

### Forcing a feature for QA or a specific user

Use `force` on the feature, not a rule. Force entries need `conditions`, have no key or percentage, and run before root conditions and rules ([features.md](references/features.md#force)).

### Promoting between Sets

Only in Sets projects. Preview with `npx featurevisor promote --from=<a> --to=<b> --include-features="<key>"`, show the created, updated and conflicting files, apply with `--apply` on the user's go ahead, then lint and test the destination set ([sets-promotions.md](references/sets-promotions.md)).

### Debugging an evaluation

Run `npx featurevisor evaluate --feature=<key> --context='{…}' --explain` rather than reasoning from YAML. It names the deciding rule or force entry, prints the bucket, and probes each condition leaf. When the surprise is in an application, also compare the application's actual context and datafile revision ([querying.md](references/querying.md#why-does-this-context-get-this-value)).

### Visual review with the Catalog

`npx featurevisor catalog` serves a read-only UI of the whole project at `http://127.0.0.1:3000` and reloads on every saved change. For sessions with several changes, or users who prefer not to read YAML, start it once in the background and open the URL in your browser tool if you have one, or give it to the user. Use `--port=<n>` if 3000 is taken.

### Upgrades

v3 to v4: [upgrading-to-v4.md](references/upgrading-to-v4.md). v2 to v3: [upgrading-to-v3.md](references/upgrading-to-v3.md). Both start with the installed CLI's `lint` output as the worklist, and both keep the project and its applications on a safe deployment order.

### Named patterns

Progressive rollouts, A/B and multivariate tests, kill switches, scheduled launches, staged rollouts from employees to everyone, early access programmes, app version gates, entitlements, backend migrations and flag cleanup each have a recipe in [recipes.md](references/recipes.md).

## Changes ship through Git

Nothing takes effect until it travels the pipeline: **edit, review, merge, CI (lint, test, build), datafile deployed, each application's next datafile refresh.**

- **Do not commit or push unless asked.** Editing files and running the CLI is your job. Landing the change belongs to the user and their CI.
- Keep one logical change per pull request, with its spec updates.
- When asked "when will this be live?", walk that pipeline and add up the waits: CI, the cache in front of the datafiles, then each application's next fetch. With a five minute cache and a five minute refresh interval, a change can take ten minutes after deployment to reach everyone. Mobile apps usually fetch when they open or return to the foreground. [How long a change takes](https://featurevisor.com/docs/deployment/#how-long-a-change-takes) walks through it.

## Application integration (SDKs)

- **JavaScript or TypeScript** in Node.js, browsers, edge runtimes or React Native: read [sdk-javascript.md](references/sdk-javascript.md) in full.
- **React**: [sdk-react.md](references/sdk-react.md). **Vue**: [sdk-vue.md](references/sdk-vue.md).
- **Typed keys and values**: [code-generation.md](references/code-generation.md).
- **Other languages**: [sdk-other-languages.md](references/sdk-other-languages.md). Every SDK reads the same datafile and buckets identically, and each ships a CLI that runs the project's specs through that language.
- **OpenFeature**: [openfeature.md](references/openfeature.md).
- **Frameworks**: [Next.js](https://featurevisor.com/docs/frameworks/nextjs/), [Express](https://featurevisor.com/docs/frameworks/express/), [Fastify](https://featurevisor.com/docs/frameworks/fastify/), [Astro](https://featurevisor.com/docs/frameworks/astro/), [Nuxt](https://featurevisor.com/docs/frameworks/nuxt/).

Evaluations are local and synchronous, with no network call. The application loads a datafile and decides when to refresh it. SDKs make no network requests of their own, so the context an application passes never leaves it, which is the answer when someone asks what user data Featurevisor sees. Feature keys, variable keys and attribute names must match the project exactly: check them against the project or its Catalog rather than guessing.

## What not to do

- Do not change a feature's `bucketBy` or a rule's `key` to tidy up. It moves users.
- Do not put `enabled` on a rule. Rules do not take it, and lint rejects it (CLI 4.0.0 accepted it, but builds ignored it). Set the rule's `percentage` to `0` to switch an audience off, or add a `force` entry.
- Do not invent attribute, segment, feature or variable keys, in YAML or in application code.
- Do not archive, rename or delete a definition before `find-usage` shows nothing active depends on it.
- Do not delete a retired definition when archiving will do. A reused key brings back the old bucketing and history.
- Do not write v4 syntax into a v3 project, or publish v4 datafiles to applications still on v3 SDKs.
- Do not add `expose` unless asked. It is a temporary migration tool.
- Do not run bare `build` locally. Use `--no-state-files`.
- Do not skip lint and tests, or report a change as done without the [definition of done](#definition-of-done).
- Do not author project definitions inside an application repository.
