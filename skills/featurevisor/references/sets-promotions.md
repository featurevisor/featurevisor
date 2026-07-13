# Sets and Promotions

Full docs:

- Sets: <https://featurevisor.com/docs/sets>
- Promotions: <https://featurevisor.com/docs/promotions>

Sets split one Featurevisor project into **independent trees** that each own their own attributes, segments, features, targets, and tests. Promotions copy definitions between sets. Most projects don't need either — reach for them only when the situations below apply.

## When to use sets (and when not to)

| Situation                                                                                                          | Use                                        |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Same features, different rollout state per env, one team owns everything                                           | Plain **environments** — no sets           |
| Release lanes where changes **graduate** through review gates (dev → staging → production), possibly with different owners per lane | **Sets** (one per lane) + **promotions**   |
| Distinct surfaces (`storefront`, `admin`) that share almost nothing — different attributes, different segments      | **Sets** (one per surface)                 |
| One tree, several client bundles                                                                                    | **Tags + targets** — no sets               |

The key property: the **same feature key can exist in multiple sets with entirely different definitions** — different rules, even different variables. With plain environments, one file holds all envs and any edit touches the single source of truth for every env. With sets-as-lanes, promoting to production is an explicit, reviewable file change in `sets/production/`, and `CODEOWNERS` can give each lane different approvers ([recipes.md](recipes.md#establishing-ownership)).

Don't propose converting a working environments-based project to sets unprompted — it's a restructuring with real migration cost.

## Enabling and layout

```js
// featurevisor.config.js
module.exports = {
  sets: true,          // default false
  tags: ['all'],
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
├── staging/
│   └── … same layout
└── production/
    └── … same layout
```

The set name is the directory name. There are no shared/top-level definitions — each set is self-contained (that's what makes promotion's dependency-copying necessary).

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

Without environments: `datafiles/<set>/featurevisor-<target>.json`. Applications simply load the datafile URL for their set — nothing set-specific in SDK code.

State lives per set under `.featurevisor/sets/<set>/` (its own `REVISION` and `existing-state-<environment>.json`).

## Scoping commands with `--set`

Every project command runs across all sets by default; scope with `--set=<set>`:

```bash
npx featurevisor test --set=storefront
npx featurevisor build --no-state-files --set=storefront
npx featurevisor list --features --set=storefront --json --pretty
npx featurevisor evaluate --set=storefront --environment=production --feature=promoBanner --context='{…}'
```

**`--json` output requires `--set`** in a sets project (`list`, `evaluate`, `build --json`) — there's no single answer across trees. When querying on the user's behalf, ask or infer which set they mean; when auditing, loop over the sets.

Authoring in a sets project means writing inside the right set's tree: `sets/<set>/features/<key>.yml`. Everything else in this skill (feature shapes, segments, testing, linting) applies unchanged within each set.

## Promotions

`promote` copies definitions from one set to another — the release-lane workflow. **It previews by default and only writes with `--apply`.**

```bash
npx featurevisor promote --from=dev --to=staging                 # preview: created/updated/unchanged/conflicts
npx featurevisor promote --from=dev --to=staging --showUnchanged
npx featurevisor promote --from=dev --to=staging --apply         # write destination files
npx featurevisor promote --from=dev --to=staging --apply --audit=markdown   # + audit trail
```

The preview reports the dependency counts and every destination file it would create or update — show this to the user before applying.

### Dependency closure

Promoting a feature automatically brings everything it needs: referenced segments (and their nested segments), attributes, reusable schemas, `required` features, exclusion-group members, the group files, matching test specs — and with `--target`, the target definition itself. You never hand-copy a segment to make a promoted feature lint.

### Filtering

```bash
npx featurevisor promote --from=dev --to=staging --target=web                    # everything one target's datafile needs
npx featurevisor promote --from=dev --to=staging --tag=web                       # features carrying a tag
npx featurevisor promote --from=dev --to=staging --includeFeatures="checkout*"   # glob on feature keys
npx featurevisor promote --from=dev --to=staging --excludeFeatures="experimental*"
```

Positive selectors (`--target`, `--tag`, `--includeFeatures`) combine with **AND**; `--excludeFeatures` applies last and wins. Dependency closure may still pull in features the filters didn't name (required features, group members). An empty selection fails loudly (override with `--allowEmpty`); unknown `--target`/`--tag` values fail and list what exists.

For a single feature, `--includeFeatures="<exactKey>"` is the precise tool.

### Conflicts

A definition existing in both sets with different values is a conflict. `--conflicts=` controls resolution:

| Value         | Behavior                                          |
| ------------- | -------------------------------------------------- |
| `source`      | Source overwrites destination (**default**)        |
| `destination` | Destination keeps its values                       |
| `fail`        | Stop with an error instead of overwriting          |

Preview first specifically to see the conflict list. When lanes intentionally diverge (production at 10%, dev at 100%), plain `--conflicts=source` would stomp production's rollout state — that's what `promotable: false` is for.

### `promotable: false` — protecting lane-specific state

Set it on a definition (feature, attribute, segment, group, schema, target, or test spec) to preserve the **destination** version during promotion. A missing destination is still created (and keeps the flag for later promotions).

Rules are stricter and this is the powerful part:

```yaml
# sets/production/features/checkoutFlow.yml
description: Checkout flow
rules:
  - key: internal-testing
    promotable: false        # production-only rule: promotions never remove it
    segments: internal
    percentage: 100

  - key: everyone
    segments: '*'
    percentage: 50           # production's own rollout state
```

A **source** rule with `promotable: false` is omitted from promotion; an **existing destination** rule with it is preserved. This lets each lane keep its own QA rules and rollout percentages while structure (variables, variations, new rules) flows through.

### `promotionFlows` — allowed directions

By default any set can promote to any other. Restrict to the real pipeline:

```js
promotionFlows: [
  { from: 'dev', to: 'staging' },
  { from: 'staging', to: 'production' },
]
```

Now `promote --from=dev --to=production` fails — no lane-skipping. Check this config value before suggesting a promotion path.

### Audit files

`--audit=markdown` (human) or `--audit=json` (machine) writes a promotion record under `.featurevisor/promotions/` — useful with `--apply` for a compliance trail.

## Agent guidance

- **`promote --apply` writes files** — the one CLI command in this skill that modifies definitions. Treat it like an edit: preview first, show the user the created/updated/conflict summary, apply only with their go-ahead, then `npx featurevisor lint` and `npx featurevisor test --set=<to>`.
- The promoted files are ordinary working-tree changes — they still go through the project's normal Git/PR flow ([SKILL.md → Changes ship through Git](../SKILL.md#changes-ship-through-git)).
- When the user says "promote X to staging" for a single feature, use `--includeFeatures="X"` and let dependency closure handle the rest.
- When a promotion keeps overwriting something lane-specific, the fix is usually `promotable: false` on the destination rule/definition, not `--conflicts=destination` (which blocks *all* updates to existing definitions, not just the protected one).

## Release-lane workflow (canonical shape)

1. Feature is born in `sets/dev/` — 100% to everyone in dev.
2. `promote --from=dev --to=staging --includeFeatures="newCheckout" --apply` when ready for QA.
3. QA signs off → `promote --from=staging --to=production --includeFeatures="newCheckout" --apply`. Production's own rollout rule (protected or edited in place) starts at a low percentage and ramps by direct edits to `sets/production/`.
4. `promotionFlows` enforces the dev → staging → production order; `CODEOWNERS` on `sets/production/*` gives release owners the approval gate.

The monorepo ships working examples: [example-sets](https://github.com/featurevisor/featurevisor/tree/main/examples/example-sets) (surfaces: storefront/admin) and [example-test-environments](https://github.com/featurevisor/featurevisor/tree/main/examples/example-test-environments) (lanes: dev/staging/production with `promotionFlows`).
