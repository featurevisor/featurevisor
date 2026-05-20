---
name: featurevisor
description: Author and query Featurevisor projects — Git-based feature flags and experimentation. Use whenever the user mentions Featurevisor, edits files under attributes/, segments/, features/, groups/, schemas/, or tests/, asks to roll out / target / A-B test a feature, asks where a feature/segment is enabled or used, runs `featurevisor` CLI commands, or works in a directory containing featurevisor.config.js. Covers creating features (flags, variations, variables), segments (conditions, operators), attributes, reusable schemas, groups (mutual exclusion), force rules, required dependencies, test specs, linting, building datafiles, evaluation debugging, and querying the project via CLI. SDK usage is out of scope — link to featurevisor.com/docs/sdks for that.
---

# Featurevisor

You are helping the user author and query a [Featurevisor](https://featurevisor.com) project — a Git-based feature management tool. Featurevisor projects are standalone repositories of YAML (default) or JSON definitions that compile into per-environment/per-tag datafiles consumed by SDKs.

The full documentation as a single file is at <https://featurevisor.com/llms.txt>. Fetch it on demand if a topic isn't covered in this skill's references.

## Orient yourself first

Before authoring anything, take a few seconds to ground in the actual project. **Always run these once at the start of a Featurevisor task:**

```bash
npx featurevisor config --json --pretty
npx featurevisor info
```

From the config note:
- `environments` — array of env names (or `false` for no envs). Their names drive `rules:`, `force:`, `expose:` keys.
- `tags` — must include any tag you put on a feature.
- `splitByEnvironment` — if `true`, rules/force/expose live in `environments/<env>/<feature>.yml`, **not** in the base feature file.
- `parser` — if `"json"` author in JSON; otherwise YAML. Inspect a couple of existing files to confirm the on-disk style.
- `defaultBucketBy` — default is `userId`, but projects may override.
- Directory paths (`featuresDirectoryPath`, etc.) — respect any overrides.

Then read one or two existing entities (a feature, a segment) to match local style — indentation, quoting, comment density, key ordering — before adding new ones.

## When to load which reference

This file is loaded eagerly. The files below are loaded only when relevant — read them in full **before** authoring or debugging in that area, don't rely on the summary in this file.

| Task                                                          | Read                                               |
| ------------------------------------------------------------- | -------------------------------------------------- |
| Create or edit a feature (flags, variations, variables, etc.) | [features.md](references/features.md)              |
| Write or change segment conditions                            | [segments.md](references/segments.md)              |
| Look up a condition operator                                  | [operators.md](references/operators.md)            |
| Define or change an attribute                                 | [attributes.md](references/attributes.md)          |
| Variables, JSON-Schema-ish types, reusable `schemas/`         | [variables-schemas.md](references/variables-schemas.md) |
| Variable overrides with deep merge (`mutations`)              | [variables-schemas.md](references/variables-schemas.md#mutations) |
| Mutually-exclusive experiments via `groups/`                  | [groups.md](references/groups.md)                  |
| Write a `.spec.yml` test, run `featurevisor test`             | [testing.md](references/testing.md)                |
| Any CLI invocation, flags, `list`/`find-usage`/`evaluate`     | [cli.md](references/cli.md)                        |
| Answer "what's enabled where / who uses X"                    | [querying.md](references/querying.md)              |
| `featurevisor.config.js`, environments, tags, scopes          | [configuration.md](references/configuration.md)    |

Templates that mirror docs examples live in [templates/](templates/) — copy and adapt them rather than writing from memory.

## Core authoring rules

These apply to every change. Internalize them; the references add depth, they do not override these.

### 1. Bucketing and rule keys are append-only contracts

- `bucketBy` is what keeps a user's experience consistent as percentages ramp. Pick once, never silently change it.
- Default for signed-in users: `userId`. For anonymous users: `deviceId` (or whatever the project calls it). **The attribute names may differ in this project — read the `attributes/` directory and ask the user which to use if it isn't obvious.** Do not invent attribute names.
- Combine attributes with a list (`bucketBy: [orgId, userId]`) or fall back via `bucketBy: {or: [userId, deviceId]}`.
- Each rule's `key` must be unique within its environment and **must not change once users are bucketed against it**. Renaming a rule key re-buckets users — the same user can lose or gain the feature. Add a new rule rather than renaming.
- Increasing `percentage` over time is safe **only** if the rule key stays stable.

### 2. First matching rule wins

Rules are evaluated top-to-bottom per environment. Put narrow targeting (e.g. country-specific rollouts at 100%) before the catch-all `segments: '*'` rule.

### 3. Don't author rules that target unknown segments or attributes

Before referencing `segments: foo` in a rule, confirm `segments/foo.yml` exists (or create it). Same for attributes referenced inside segment conditions. Run `npx featurevisor lint` after edits — it catches dangling refs, percentage-sum errors in groups and variations, and schema mismatches.

### 4. Respect `splitByEnvironment` if enabled

If `splitByEnvironment: true`:
- Base file `features/<key>.yml` holds metadata (description, tags, bucketBy, variations, variablesSchema, required, etc.) — **no** `rules`, `force`, or `expose`.
- Per-environment file `environments/<env>/<key>.yml` holds `rules`, `force`, `expose` for that env.

### 5. Variations weights sum to 100; group slot percentages sum to 100

And a feature in a group cannot use a rollout `percentage` higher than its slot's percentage.

### 6. After any edit, lint

```bash
npx featurevisor lint
```

If you wrote or changed a test spec, also run:

```bash
npx featurevisor test --keyPattern=<theKey>
```

## CLI: run freely

All `featurevisor` CLI commands are local and safe to run without confirmation. For `build`, **always pass `--no-state-files`** so it doesn't increment the project's revision locally:

```bash
npx featurevisor build --no-state-files
```

The most useful commands for an authoring agent (full reference in [cli.md](references/cli.md)):

| Command                                                           | Purpose                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `npx featurevisor config --json --pretty`                         | Project configuration                                  |
| `npx featurevisor info`                                           | Counts of features / segments / attributes / tests     |
| `npx featurevisor lint`                                           | Validate definitions (run after every edit)            |
| `npx featurevisor list --features --json [--filters…]`            | Find features by tag, env, variable, archived, etc.    |
| `npx featurevisor list --segments --json`                         | List segments                                          |
| `npx featurevisor list --attributes --json`                       | List attributes                                        |
| `npx featurevisor find-usage --segment=<key>`                     | Where a segment is used                                |
| `npx featurevisor find-usage --attribute=<key>`                   | Where an attribute is used                             |
| `npx featurevisor find-usage --feature=<key>`                     | Feature usage details                                  |
| `npx featurevisor find-usage --unusedSegments`                    | Dead segments                                          |
| `npx featurevisor find-usage --unusedAttributes`                  | Dead attributes                                        |
| `npx featurevisor find-duplicate-segments`                        | Segments with identical conditions                     |
| `npx featurevisor evaluate --environment=<e> --feature=<k> --context='{…}'` | Why a feature evaluates the way it does (debug) |
| `npx featurevisor assess-distribution --environment=<e> --feature=<k> --context='{…}' --populateUuid=userId --n=1000` | Simulate rollout distribution |
| `npx featurevisor test [--keyPattern=…] [--assertionPattern=…]`   | Run test specs                                         |
| `npx featurevisor build --no-state-files`                         | Build datafiles without touching local revision/state  |

**Prefer the CLI over grepping** when answering questions like "what features use segment X?", "which features are enabled in production?", or "why does feature F evaluate to disabled for this context?". The CLI's `--json` output is parseable and authoritative.

## Common authoring flows

### Adding a new feature flag

1. Read the existing `features/` directory to match conventions (file naming, comment style).
2. Confirm the attribute used for `bucketBy` exists in `attributes/`; ask the user which to use if multiple plausible options exist (e.g. `userId` vs `deviceId`).
3. Create `features/<key>.yml` from [templates/feature.yml](templates/feature.yml).
4. If targeting specific segments, ensure each referenced segment exists in `segments/` — create it from [templates/segment.yml](templates/segment.yml) if not.
5. Run `npx featurevisor lint`.
6. Offer (don't force): "I can add a `tests/features/<key>.spec.yml` covering this — want me to?" If yes, use [templates/test-feature.spec.yml](templates/test-feature.spec.yml).

### Adding variations (A/B test)

Read [features.md](references/features.md) on variations, then use [templates/feature-with-variations.yml](templates/feature-with-variations.yml). Remind the user that weights sum to 100 and the `control`/`treatment` names are conventional only.

### Adding variables (remote config)

Read [variables-schemas.md](references/variables-schemas.md) — covers all variable types, the inline JSON-Schema-ish form, reusable `schemas/`, variation-level variables, rule-level `variables:` and `variableOverrides:`, and the `mutations` feature for deep-merge overrides. Use [templates/feature-with-variables.yml](templates/feature-with-variables.yml) as the starting shape.

### Complex targeting (and/or/not)

Both segment `conditions` and feature rule `segments` support `and`, `or`, `not` with nesting. See [segments.md](references/segments.md) and [templates/segment-complex.yml](templates/segment-complex.yml).

### Mutual-exclusion experiments

Read [groups.md](references/groups.md). Plan slot percentages **before** adding rules — once users are bucketed in a group, changing slot percentages re-buckets them. Use [templates/group.yml](templates/group.yml).

### Force-enabling for QA / a specific user

Use `force:` on the feature (per-environment), not `rules`. No `key`/`percentage` needed. See [features.md](references/features.md#force).

### Debugging an evaluation

Use `npx featurevisor evaluate --environment=<e> --feature=<k> --context='{…}' --verbose` rather than reading the YAML and reasoning by hand. The evaluation flow (sticky → required → forced → rules → bucketing) is documented in [features.md](references/features.md#evaluation-flow).

### Querying ("what's enabled where?", "who uses this segment?")

See [querying.md](references/querying.md). It shows the right `list`/`find-usage`/`evaluate` invocations for the common questions a developer asks about an existing project.

## SDK use cases

SDK implementation is **out of scope** for this skill — focus on authoring and querying. If the user needs SDK help, point them at:

- JavaScript / TypeScript: <https://featurevisor.com/docs/sdks/javascript>
- React: <https://featurevisor.com/docs/react>
- Vue: <https://featurevisor.com/docs/vue>
- React Native: <https://featurevisor.com/docs/react-native>
- Other languages (Python, Ruby, Go, Java, Swift, PHP, etc.): <https://featurevisor.com/docs/sdks>
- Full docs as a single file: <https://featurevisor.com/llms.txt>

You may briefly explain how an authored feature would be consumed (`f.isEnabled('key')`, `f.getVariation('key')`, `f.getVariable('key', 'varName')`), but don't write application code unless asked.

## What not to do

- Do not change a feature's `bucketBy` or a rule's `key` "to clean things up" — that re-buckets users.
- Do not invent attribute or segment names. Verify they exist; create them explicitly if needed.
- Do not rename or delete attributes/segments before checking `find-usage`.
- Do not add `expose:` unless the user asks — it's a short-term migration tool.
- Do not run `build` without `--no-state-files`.
- Do not skip `npx featurevisor lint` after edits.
