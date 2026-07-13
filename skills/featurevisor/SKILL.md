---
name: featurevisor
description: Author, query, and integrate Featurevisor — Git-based feature flags, A/B experiments, and remote config. Use whenever the user mentions Featurevisor, works in a project containing featurevisor.config.js, edits files under attributes/, segments/, features/, groups/, schemas/, targets/, sets/, or tests/, runs `featurevisor` CLI commands, or asks to add/roll out/ramp/target/A-B test/force-enable a feature flag, set up remote config or entitlements, or asks where a feature/segment is used or why it evaluated that way. Also use when consuming Featurevisor from app code — @featurevisor/sdk, @featurevisor/react, @featurevisor/vue, datafiles, createFeaturevisor, isEnabled/getVariation/getVariable. Covers starting a project from scratch, features (flags, variations, variables), segments, attributes, schemas, groups (mutual exclusion), dependencies, test specs, linting, building/deploying datafiles, evaluation debugging, the Catalog, and analytics tracking.
---

# Featurevisor

You are helping the user with [Featurevisor](https://featurevisor.com) — a Git-based feature management tool. A Featurevisor **project** is a repository of YAML (default) or JSON definitions that compile into static JSON **datafiles**, which applications evaluate locally through SDKs. There are two sides to every task:

- **Project side** — authoring/querying the definitions repo (features, segments, attributes, tests) and running the `featurevisor` CLI.
- **Application side** — consuming datafiles via SDKs (`@featurevisor/sdk`, React, Vue, or other languages).

This skill covers both. The compact documentation index is at <https://featurevisor.com/llms.txt> and the complete feed at <https://featurevisor.com/llms-full.txt> — fetch on demand if a topic isn't covered in this skill's references.

## Know your audience

Featurevisor is used by engineers, product managers, marketers, and people who describe what they want without knowing the YAML. Calibrate:

- **Not sure of the vocabulary?** Someone asking to "turn on the banner for 10% of Dutch users" wants a rollout rule — don't make them learn the words `segment`, `bucketBy`, or `percentage` first. Do the mapping for them, then show the result in their language: what changed, who is affected, what happens next.
- **Safe vs. risky changes.** Ramping a percentage up, adding a new rule, adding a feature, force-enabling for QA — routine; do them confidently. Renaming rule keys, changing `bucketBy`, resizing group slots, decreasing percentages — these silently re-bucket users; warn plainly ("some users would lose the feature mid-session") before proceeding.
- **Always close the loop.** After any change, say in one or two sentences what will happen when it ships (e.g. "once this merges and CI deploys the datafile, ~10% of users in NL will see the banner; the rest see nothing").
- For anyone who wants to *see* the project, offer the **Catalog** — a browsable read-only UI with live reload (see [Visual review with Catalog](#visual-review-with-catalog)).

## Orient yourself first

**If there is no `featurevisor.config.js`** anywhere in the working tree, there is no Featurevisor project yet. Two possibilities:

- The user wants one → scaffold it: `npx @featurevisor/cli init` in an empty directory (then `npm install`), or copy [templates/example-project/](templates/example-project/) as a starting point. Keep the project a **separate repo** from application code — that separation (review flags like code, deploy datafiles independently) is the point of the tool.
- The user is in an **application repo** consuming Featurevisor → this is SDK work; see [Application integration](#application-integration-sdks) below. Author definitions in the project repo, not here.

**If a project exists, always run these once at the start:**

```bash
npx featurevisor config --json --pretty
npx featurevisor info
```

From the config note:

- `environments` — optional array of env names. If omitted, the project has no environments and `rules`, `force`, and `expose` are direct values.
- `tags` — must include any tag you put on a feature.
- `namespaceCharacter` — separator for directory-namespaced keys. **Default `.`** (`features/checkout/promo.yml` → `checkout.promo`); some projects use `/`.
- `sets` — if `true`, each directory under `sets/<set>/` is an independent project tree.
- `parser` — if `"json"` author in JSON; otherwise YAML. Inspect a couple of existing files to confirm the on-disk style.
- `defaultBucketBy` — default is `userId`, but projects may override.
- Directory paths (`featuresDirectoryPath`, etc.) — respect any overrides.

Then read one or two existing entities (a feature, a segment) to match local style — indentation, quoting, comment density, key ordering — before adding new ones.

## When to load which reference

This file is loaded eagerly. The files below are loaded only when relevant — read them in full **before** authoring or debugging in that area, don't rely on the summary in this file.

| Task                                                                                                                                          | Read                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Create or edit a feature (flags, variations, variables, etc.)                                                                                 | [features.md](references/features.md)                             |
| Write or change segment conditions                                                                                                            | [segments.md](references/segments.md)                             |
| Look up a condition operator                                                                                                                  | [operators.md](references/operators.md)                           |
| Define or change an attribute                                                                                                                 | [attributes.md](references/attributes.md)                         |
| Variables, JSON-Schema-ish types, reusable `schemas/`                                                                                         | [variables-schemas.md](references/variables-schemas.md)           |
| Variable overrides with deep merge (`mutations`)                                                                                              | [variables-schemas.md](references/variables-schemas.md#mutations) |
| Mutually-exclusive experiments via `groups/`                                                                                                  | [groups.md](references/groups.md)                                 |
| Bucketing, `bucketBy`, state files, sticky                                                                                                    | [bucketing.md](references/bucketing.md)                           |
| Tags — feature metadata used by targets                                                                                                       | [tags.md](references/tags.md)                                     |
| Targets — generated datafile definitions                                                                                                      | [targets.md](references/targets.md)                               |
| Namespaces — directory-based feature/segment key prefixes                                                                                     | [namespaces.md](references/namespaces.md)                         |
| `featurevisor.config.js`, environments, sets, promotions                                                                                      | [configuration.md](references/configuration.md)                   |
| JSON / TOML / other format projects                                                                                                           | [custom-parsers.md](references/custom-parsers.md)                 |
| Build datafiles, deploy to CDN, CI pipeline                                                                                                   | [building-datafiles.md](references/building-datafiles.md)         |
| Write a `.spec.yml` test, run `featurevisor test`                                                                                             | [testing.md](references/testing.md)                               |
| Any CLI invocation, flags, `list`/`find-usage`/`evaluate`                                                                                     | [cli.md](references/cli.md)                                       |
| Answer "what's enabled where / who uses X"; browse via Catalog                                                                               | [querying.md](references/querying.md)                             |
| **Use the SDK in an app** — JS/TS/Node/browser/edge, context, refresh, server-side                                                           | [sdk-javascript.md](references/sdk-javascript.md)                 |
| React or React Native integration (`useFlag` etc.)                                                                                           | [sdk-react.md](references/sdk-react.md)                           |
| Vue integration                                                                                                                               | [sdk-vue.md](references/sdk-vue.md)                               |
| Code generation (typed TS bindings)                                                                                                           | [code-generation.md](references/code-generation.md)               |
| Analytics activation modules (GA4 / Segment / etc.)                                                                                           | [tracking.md](references/tracking.md)                             |
| **Common patterns** — A/B, multivariate, entitlements, kill switches, scheduled releases, staged rollouts, version gating, migrations, testing-in-prod, deprecation/cleanup, microfrontends, ownership, trunk-based dev | [recipes.md](references/recipes.md)                               |
| Terminology refresher                                                                                                                         | [glossary.md](references/glossary.md)                             |

Per-entity templates live in [templates/](templates/) — copy and adapt rather than writing from memory.

A **complete end-to-end mini project** lives in [templates/example-project/](templates/example-project/). It passes `lint` and `test` as-is — use it as the source of truth for "show me how a realistic Featurevisor project hangs together" requests.

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

Before referencing `segments: foo` in a rule, confirm the segment exists (or create it). Same for attributes referenced inside segment conditions. Run `npx featurevisor lint` after edits — it catches dangling refs, percentage-sum errors in groups and variations, and schema mismatches.

### 4. Variations weights sum to 100; group slot percentages sum to 100

And a feature in a group cannot use a rollout `percentage` higher than its slot's percentage.

### 5. After any edit, lint

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

| Command                                                                                                               | Purpose                                               |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `npx featurevisor config --json --pretty`                                                                             | Project configuration                                 |
| `npx featurevisor info`                                                                                                | Counts of features / segments / attributes / tests    |
| `npx featurevisor lint`                                                                                               | Validate definitions (run after every edit)           |
| `npx featurevisor list --features --json [--filters…]`                                                                | Find features by tag, env, variable, archived, etc.   |
| `npx featurevisor list --datafiles --json`                                                                            | List generated datafile paths                         |
| `npx featurevisor list --segments --json`                                                                             | List segments                                         |
| `npx featurevisor list --attributes --json`                                                                           | List attributes                                       |
| `npx featurevisor find-usage --segment=<key>`                                                                         | Where a segment is used                               |
| `npx featurevisor find-usage --attribute=<key>`                                                                       | Where an attribute is used                            |
| `npx featurevisor find-usage --feature=<key>`                                                                         | Feature usage details                                 |
| `npx featurevisor find-usage --unusedSegments`                                                                        | Dead segments                                         |
| `npx featurevisor find-usage --unusedAttributes`                                                                      | Dead attributes                                       |
| `npx featurevisor find-duplicate-segments`                                                                            | Segments with identical conditions                    |
| `npx featurevisor evaluate --environment=<e> --feature=<k> --context='{…}'`                                           | Why a feature evaluates the way it does (debug)       |
| `npx featurevisor assess-distribution --environment=<e> --feature=<k> --context='{…}' --populateUuid=userId --n=1000` | Simulate rollout distribution                         |
| `npx featurevisor test [--keyPattern=…] [--assertionPattern=…]`                                                       | Run test specs                                        |
| `npx featurevisor build --no-state-files`                                                                             | Build datafiles without touching local revision/state |
| `npx featurevisor catalog`                                                                                             | Browsable read-only UI of the whole project           |

**Prefer the CLI over grepping** when answering questions like "what features use segment X?", "which features are enabled in production?", or "why does feature F evaluate to disabled for this context?". The CLI's `--json` output is parseable and authoritative.

Use optional, repeatable `--target=<target>` selection with `build`, `test`, `evaluate`, `benchmark`, `assess-distribution`, `list --features`, and `info` when the question concerns deployed target datafiles. Runtime commands process each selected target independently. `build --json` and `build --print` accept only one target because they emit one datafile.

## Changes ship through Git

Featurevisor is GitOps: nothing you write takes effect until it travels the pipeline —

**edit → PR review → merge → CI (lint, test, build) → datafile deployed to CDN → each app's next datafile refresh.**

Practical consequences:

- **Don't commit or push unless asked.** Editing files and running the CLI is your job; landing the change is the user's (or their CI's).
- Keep one logical change per branch/PR (a rollout bump, a new feature, a cleanup) — flags get reviewed like code, and small diffs get approved fast.
- Update or add the matching `.spec.yml` in the same change when behavior expectations shift.
- When the user asks **"when will this be live?"**, walk that pipeline: after merge, CI deploys the datafile, and apps pick it up on their next refresh (an app polling every 5 minutes lags up to 5 minutes). For emergency paths, see the kill-switch recipe in [recipes.md](references/recipes.md).

## Common authoring flows

### Starting a brand-new project

1. In an empty directory (a new repo, separate from app code): `npx @featurevisor/cli init`, then `npm install`.
2. Adjust `featurevisor.config.js` (`environments`, `tags`) to the user's world.
3. Replace the scaffolded example entities with the user's first real attribute → segment → feature, in that order (features reference segments; segments reference attributes).
4. `npx featurevisor lint && npx featurevisor build --no-state-files` to prove the pipeline.
5. Offer the CI/CDN deployment setup from [building-datafiles.md](references/building-datafiles.md) when they're ready to ship.

### Adding a new feature flag

1. Read the existing `features/` directory to match conventions (file naming, comment style).
2. Confirm the attribute used for `bucketBy` exists in `attributes/`; ask the user which to use if multiple plausible options exist (e.g. `userId` vs `deviceId`).
3. Create `features/<key>.yml` from [templates/feature.yml](templates/feature.yml).
4. If targeting specific segments, ensure each referenced segment exists in `segments/` — create it from [templates/segment.yml](templates/segment.yml) if not.
5. Run `npx featurevisor lint`.
6. Offer (don't force): "I can add a `tests/features/<key>.spec.yml` covering this — want me to?" If yes, use [templates/test-feature.spec.yml](templates/test-feature.spec.yml).

### Adding variations (A/B test)

Read [features.md](references/features.md) on variations, then use [templates/feature-with-variations.yml](templates/feature-with-variations.yml). Remind the user that weights sum to 100 and the `control`/`treatment` names are conventional only. If they ask how results get measured, that's [tracking.md](references/tracking.md).

### Adding variables (remote config)

Read [variables-schemas.md](references/variables-schemas.md) — covers all variable types, the inline JSON-Schema-ish form, reusable `schemas/`, variation-level variables, rule-level `variables:` and `variableOverrides:`, and the `mutations` feature for deep-merge overrides. Use [templates/feature-with-variables.yml](templates/feature-with-variables.yml) as the starting shape.

### Complex targeting (and/or/not)

Both segment `conditions` and feature rule `segments` support `and`, `or`, `not` with nesting. See [segments.md](references/segments.md) and [templates/segment-complex.yml](templates/segment-complex.yml).

Important `not` rule: multiple direct children are treated as an implicit **AND** and then negated. So `not: [A, B]` means `not (A and B)`, not `not A and not B`. For "none of these match", wrap them in `or`: `not: [{ or: [A, B] }]`.

### Mutual-exclusion experiments

Read [groups.md](references/groups.md). Plan slot percentages **before** adding rules — once users are bucketed in a group, changing slot percentages re-buckets them. Use [templates/group.yml](templates/group.yml).

### Force-enabling for QA / a specific user

Use `force:` on the feature (per-environment), not `rules`. No `key`/`percentage` needed. See [features.md](references/features.md#force).

### Debugging an evaluation

Use `npx featurevisor evaluate --environment=<e> --feature=<k> --context='{…}' --verbose` rather than reading the YAML and reasoning by hand. The evaluation flow (sticky → required → forced → rules → bucketing) is documented in [features.md](references/features.md#evaluation-flow). If the surprise is in an application rather than the project, also check the app's actual context and datafile revision ([sdk-javascript.md](references/sdk-javascript.md#why-did-it-evaluate-that-way)).

### Querying ("what's enabled where?", "who uses this segment?")

See [querying.md](references/querying.md). It shows the right `list`/`find-usage`/`evaluate` invocations for the common questions a developer asks about an existing project, plus the Catalog for browsing.

### Visual review with Catalog

`npx featurevisor catalog` serves a read-only UI of the whole project at `http://127.0.0.1:3000` **in watch mode** — it rebuilds and reloads the browser whenever definition files change. That makes it the ideal companion to an authoring session:

1. Start it once as a background process (it's local and read-only — safe to leave running).
2. If you have a browser tool, open `http://127.0.0.1:3000` in it; otherwise give the user the URL.
3. Author changes as usual — every edit shows up in the Catalog on save, so the user watches features, rules, variables, and test coverage evolve visually while they prompt you.

Offer this proactively when a session involves several authoring changes or when the user is less comfortable reading YAML — prompting plus a live Catalog is the best way to experience Featurevisor. Details in [querying.md](references/querying.md).

### Recipes for higher-level use cases

When the request matches a named pattern — A/B test, multivariate, mutual exclusion, dependencies, remote config, entitlements/RBAC, kill switch, scheduled/time-window release, staged rollout ladder (employees → beta → everyone), app version gating, backend migration, stale-flag cleanup, testing in production, deprecation, trunk-based development, microfrontends, decoupling release from deploy, ownership — open [recipes.md](references/recipes.md) and adapt the matching section. It links back to the granular references for shape details.

## Application integration (SDKs)

When the task is consuming features from application code:

- **JavaScript / TypeScript / Node / browser / edge** → read [sdk-javascript.md](references/sdk-javascript.md) in full. It covers install, context, all evaluation methods, datafile refresh and on-demand loading, events, sticky, server-side child instances (`spawn`), diagnostics, and modules.
- **React / React Native** → [sdk-react.md](references/sdk-react.md). **Vue** → [sdk-vue.md](references/sdk-vue.md).
- **Type-safe bindings** (generated `isEnabled`/`getVariation` with compile-checked keys) → [code-generation.md](references/code-generation.md).
- **Other languages** — SDKs are **cross-platform**: Python, Ruby, Go, Java, Swift, PHP, Roku, and more, with the up-to-date list at <https://featurevisor.com/docs/sdks>. Every SDK consumes the same datafiles, exposes the same concepts (context, `isEnabled`/`getVariation`/`getVariable`), and implements the same deterministic bucketing — so a user bucketed into `treatment` in a browser gets `treatment` on the backend and on mobile too. One Featurevisor project can serve an entire polyglot stack. If the user's language isn't in this skill's references, apply the concepts from [sdk-javascript.md](references/sdk-javascript.md) and fetch the language page from the website for syntax.
- **Framework guides** (Next.js, Express, Fastify, Astro, Nuxt): <https://featurevisor.com/docs/frameworks>.

Key facts that prevent most integration mistakes: evaluations are local and synchronous (no network at evaluation time); the app must load a **datafile** (built and deployed from the project repo) and decide its own refresh strategy; feature keys, variable keys, and attribute names must match the project's definitions exactly — verify against the project (or its Catalog) rather than guessing.

## What not to do

- Do not change a feature's `bucketBy` or a rule's `key` "to clean things up" — that re-buckets users.
- Do not invent attribute, segment, or feature key names — in YAML or in application code. Verify they exist; create them explicitly if needed.
- Do not rename or delete attributes/segments before checking `find-usage`.
- Do not add `expose:` unless the user asks — it's a short-term migration tool.
- Do not run `build` without `--no-state-files`.
- Do not skip `npx featurevisor lint` after edits.
- Do not author project definitions inside an application repo — they belong in the Featurevisor project repo.
