# Sets and Promotions

Full docs:

- Sets: <https://featurevisor.com/docs/sets>
- Promotions: <https://featurevisor.com/docs/promotions>

Sets split one Featurevisor project into **independent trees** that each own their own attributes, segments, features, global variables, targets, and tests. Promotions copy definitions between sets. Most projects don't need either. Use them only when the situations below apply.

## When to use sets (and when not to)

| Situation                                                                                                                           | Use                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Same features, different rollout state per env, one team owns everything                                                            | Plain **environments**: no sets          |
| Release lanes where changes **graduate** through review gates (dev → staging → production), possibly with different owners per lane | **Sets** (one per lane) + **promotions** |
| Distinct surfaces (`storefront`, `admin`) that share almost nothing: different attributes, different segments                       | **Sets** (one per surface)               |
| One tree, several client bundles                                                                                                    | **Tags + targets**: no sets              |

The key property: the **same feature key can exist in multiple sets with entirely different definitions**, with different rules, even different variables. With plain environments, one file holds all envs and any edit touches the single source of truth for every env. With sets-as-lanes, promoting to production is an explicit, reviewable file change in `sets/production/`, and `CODEOWNERS` can give each lane different approvers ([recipes.md](recipes.md#establishing-ownership)).

Don't propose converting a working environments-based project to sets unprompted: it's a restructuring with real migration cost.

## Enabling and layout

```js
// featurevisor.config.js
module.exports = {
  sets: true,          // default false
  // environments: [...] — optional; sets work with or without environments
  // promotionFlows: [...] — see Promotions below
}
```

```
sets/
├── dev/
│   ├── attributes/
│   ├── segments/
│   ├── features/
│   ├── targets/          # each set needs at least one target
│   └── tests/
│       └── scenarios/
├── staging/
│   └── … same layout
└── production/
    └── … same layout
```

The set name is the directory name. There are no shared top level definitions. Each set is self contained, which is what makes promotion dependency copying necessary. Entity tests and standalone scenario `.spec.yml` files can live anywhere under the set's `tests/` tree. `tests/scenarios/` is recommended organization for scenarios only.

## Build output and state

`npx featurevisor build --no-state-files` builds every set. Output nests set first, then environment (if any):

```
datafiles/
└── storefront/
    ├── staging/
    │   └── featurevisor-all.json
    └── production/
        └── featurevisor-all.json
```

Without environments: `datafiles/<set>/featurevisor-<target>.json`. Applications simply load the datafile URL for their set. Nothing in the SDK code is specific to the set.

State lives per set under `.featurevisor/sets/<set>/` (its own `REVISION` and `existing-state-<environment>.json`).

## Scoping commands with `--set`

Add `--environment=<name>` to evaluation commands only when the project configures environments. A Set name is not an environment name.

Every project command runs across all sets by default. Scope with `--set=<set>`:

```bash
npx featurevisor test --set=storefront
npx featurevisor build --no-state-files --set=storefront
npx featurevisor list --features --set=storefront --json --pretty
npx featurevisor evaluate --set=storefront --feature=promoBanner --context='{…}'
```

**`--json` output requires `--set`** in a sets project (`list`, `evaluate`, `build --json`): there's no single answer across trees. When querying on the user's behalf, ask or infer which set they mean. When auditing, loop over the sets.

Authoring in a sets project means writing inside the right set's tree: `sets/<set>/features/<key>.yml`. Everything else in this skill (feature shapes, segments, testing, linting) applies unchanged within each set.

## Promotions

`promote` copies definitions from one set to another for the release-lane workflow. **It previews by default and only writes with `--apply`.**

```bash
npx featurevisor promote --from=dev --to=staging                 # preview: created/updated/unchanged/conflicts
npx featurevisor promote --from=dev --to=staging --show-unchanged
npx featurevisor promote --from=dev --to=staging --apply         # write destination files
npx featurevisor promote --from=dev --to=staging --apply --audit=markdown   # + audit trail
```

The preview reports the dependency counts and every destination file it would create or update: show this to the user before applying.

Both source and destination must lint clean before planning. After merging, promotion lints the entire proposed destination, including unchanged definitions and tests. Preview and apply both reject an invalid result before any destination writes. Passing lint on each input set alone does not prove that their merged schemas and references are valid. This is preflight validation, not a filesystem transaction: an I/O failure during apply does not guarantee rollback of earlier writes. Inspect the diff before retrying.

### Dependency closure

Promoting a feature or global variable automatically brings everything it needs: referenced segments, attributes, reusable schemas, required features (including allocation features), matching test specs, and with `--target`, the target definition itself.

Selected specs also retain root and matrix Target references. A referenced Target missing from the destination is included from the source. An existing destination Target is preserved unless explicitly selected. This does not promote every entity matching that Target. Invalid Target references fail planning before writes.

### Filtering

```bash
npx featurevisor promote --from=dev --to=staging --target=web                    # everything one target's datafile needs
npx featurevisor promote --from=dev --to=staging --tag=web                       # features carrying a tag
npx featurevisor promote --from=dev --to=staging --include-features="checkout*"   # glob on feature keys
npx featurevisor promote --from=dev --to=staging --exclude-features="experimental*"
```

Positive selectors (`--target`, `--tag`, `--include-features`) combine with **AND**. `--exclude-features` applies last and wins. Dependency closure may still pull in features the filters didn't name (required features, including allocation features). An empty selection fails loudly (override with `--allow-empty`). Unknown `--target`/`--tag` values fail and list what exists.

A selected Target applies its tag selector to features and global variables. Its `includeFeatures` and `excludeFeatures` patterns filter features, while `includeVariables` and `excludeVariables` filter global variables. The Target definition itself is included in the promotion.

For a single feature, `--include-features="<exactKey>"` is the precise tool.

### Conflicts

A definition existing in both sets with different values is a conflict. `--conflicts=` controls resolution:

| Value         | Behaviour                                    |
| ------------- | -------------------------------------------- |
| `source`      | Source wins conflicting values (**default**) |
| `destination` | Destination keeps conflicting values         |
| `fail`        | Stop with an error instead of overwriting    |

Preview first specifically to see the conflict list. When lanes intentionally diverge (production at 10%, dev at 100%), plain `--conflicts=source` would stomp production's rollout state: that's what `promotable: false` is for.

Keyed overrides treat `value` versus `mutate` as conflicting alternatives. Keep only the winning form, never both fields. Their `conditions` expressions follow the selected conflict policy. `fail` rejects conflicts before writes.

Reordering matching promotable global variable override keys is a semantic conflict, even with identical bodies. `source` follows source order in the movable slots, including new overrides. `destination` retains existing order and appends new overrides in source order. `fail` rejects a reordering conflict before writes. Protected entries and entries found only in the destination keep their slots. Apply this policy recursively within every nested global override list, since order affects first match and accumulated results.

<a id="promotable-false--protecting-lane-specific-state"></a>

### `promotable: false`: protecting lane-specific state

Set it at the top level of a feature, global variable, attribute, segment, reusable schema, target, entity test spec, or standalone scenario to preserve the **destination** version during promotion. If either the source or existing destination definition has `promotable: false`, the destination stays unchanged. A missing destination is still created and keeps the flag for later promotions. This protection takes precedence over `--conflicts`.

Rules are stricter and this is the powerful part:

```yaml
description: Checkout flow

rules:
  - key: internal-testing
    promotable: false
    conditions: internal
    percentage: 100
  - key: everyone
    conditions: '*'
    percentage: 50
```

A **source** rule with `promotable: false` is omitted from promotion. An **existing destination** rule with it is preserved when a source rule with the same key is promoted. This lets each lane keep its own QA rules and rollout percentages while structure (variables, variations, new rules) flows through.

Individual feature and segment test assertions also support promotion protection. Every assertion in the spec must have a unique stable `key` when any assertion is keyed. An assertion with `promotable` must have a key.

```yaml
# sets/production/tests/features/checkoutFlow.spec.yml
feature: checkoutFlow
assertions:
  - key: production-rollout
    promotable: false
    at: 50
    context: { userId: production-user }
    expectedToBeEnabled: false

  - key: general-checkout
    at: 80
    context: { userId: general-user }
    expectedToBeEnabled: true
```

A source assertion with `promotable: false` is omitted. A protected destination assertion is preserved when a source assertion with the same key is promoted. Both source and destination specs must use assertion keys when protection is involved. Existing unkeyed specs keep whole-array promotion behaviour.

Standalone scenarios have no assertion wrapper or assertion key. Put `promotable: false` on the scenario root to protect its complete matrix and children:

```yaml
# sets/production/tests/scenarios/checkout-contract.spec.yml
promotable: false
description: Production checkout values stay consistent
checks:
  - variable: checkoutPolicy
    operator: notNull
```

Global variable overrides support item level protection through their stable `key`, including nested overrides. A protected override also protects or omits its descendants, while a protected child affects only that child and its own descendants. Keys are unique across the complete override tree for one environment. Do not put `promotable` on individual matrix cases, children, segment conditions, force entries, or nested schema properties. Protect the parent entity test assertion or standalone scenario root to protect its complete matrix and children.

<a id="promotionflows--allowed-directions"></a>

### `promotionFlows`: allowed directions

By default any set can promote to any other. Restrict to the real pipeline:

```js
promotionFlows: [
  { from: 'dev', to: 'staging' },
  { from: 'staging', to: 'production' },
]
```

Now `promote --from=dev --to=production` fails: no lane-skipping. Check this config value before suggesting a promotion path.

### Audit files

`--audit=markdown` (human) or `--audit=json` (machine) writes a promotion record under `.featurevisor/promotions/`: useful with `--apply` for a compliance trail.

## Agent guidance

- **`promote --apply` writes files**: the one CLI command in this skill that modifies definitions. Treat it like an edit: preview first, show the user the created/updated/conflict summary, apply only with their go-ahead, then `npx featurevisor lint` and `npx featurevisor test --set=<to>`.
- The promoted files are ordinary working-tree changes: they still go through the project's normal Git/PR flow ([SKILL.md → Changes ship through Git](../SKILL.md#changes-ship-through-git)).
- When the user says "promote X to staging" for a single feature, use `--include-features="X"` and let dependency closure handle the rest.
- When a promotion keeps overwriting something lane-specific, the fix is usually `promotable: false` on the destination rule/definition, not `--conflicts=destination` (which blocks _all_ updates to existing definitions, not just the protected one).

## Release-lane workflow (canonical shape)

1. Feature is born in `sets/dev/` at 100% to everyone in dev.
2. `promote --from=dev --to=staging --include-features="newCheckout" --apply` when ready for QA.
3. QA signs off → `promote --from=staging --to=production --include-features="newCheckout" --apply`. Production's own rollout rule (protected or edited in place) starts at a low percentage and ramps by direct edits to `sets/production/`.
4. `promotionFlows` enforces the dev → staging → production order. `CODEOWNERS` on `sets/production/*` gives release owners the approval gate.

Use `npx @featurevisor/cli init --example=environments` for release lanes with `promotionFlows` from dev to staging to production. The monorepo also ships [example-sets](https://github.com/featurevisor/featurevisor/tree/main/examples/example-sets) for storefront/admin surfaces and [example-test-environments](https://github.com/featurevisor/featurevisor/tree/main/examples/example-test-environments) for additional lane tests. `--example=with-environments` is different: one tree with explicit environment keyed rules.
