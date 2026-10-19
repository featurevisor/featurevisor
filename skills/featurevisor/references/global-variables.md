# Global variables

Full docs: <https://featurevisor.com/docs/variables/#global-variables>

A global variable is a typed value that stands on its own, with no feature around it: a support address, a retry limit, a kill switch, a set of checkout settings. It lives in `variables/<key>.yml`. It has no `bucketBy`, percentages or variations, so the same context and datafile always give the same value.

Choose a **feature variable** ([variables-schemas.md](variables-schemas.md)) instead when the value follows a variation, or needs a gradual percentage rollout. A global variable cannot be rolled out to 10% of users. Gate it on a feature when that is needed.

## Define one

```yaml
description: Support email shown in checkout

type: string

defaultValue: support@example.com
```

| Field                                          | Required                                            | Notes                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `description`                                  | yes                                                 |                                                                                                                          |
| `type`                                         | yes, unless `oneOf` or `schema` describes the value | `boolean`, `string`, `integer`, `number`, `object`, `array`, `json` ([variables-schemas.md](variables-schemas.md#types)) |
| `defaultValue`                                 | yes                                                 | the value when no override matches                                                                                       |
| `overrides`                                    | no                                                  | ordered list, or a map of environment to list when environments are configured                                           |
| `conditions`                                   | no                                                  | root gate                                                                                                                |
| `disabledValue`                                | no                                                  | the value while the root gate is unmet, instead of `null`                                                                |
| `useDefaultWhenDisabled`                       | no                                                  | `true` returns `defaultValue` while the gate is unmet. `disabledValue` wins when both are set                            |
| `tags`, `deprecated`, `archived`, `promotable` | no                                                  | as for features                                                                                                          |

A composition replaces `type` and `defaultValue` with `compose` ([Compose values](#compose-values)).

## Overrides

```yaml
description: Support email shown in checkout

type: string

defaultValue: support@example.com

overrides:
  - key: maintenance
    conditions:
      - variable: maintenanceMode
        operator: equals
        value: true
    value: status@example.com

  - key: priority
    conditions: payingAccounts
    value: priority@example.com

  - key: netherlands
    conditions: netherlands
    value: support-nl@example.com

  - key: newCheckout
    conditions:
      - feature: checkout
    value: checkout-help@example.com
```

- Overrides run in order and the first match wins. A paying Dutch account gets `priority@example.com`, because `priority` comes first.
- A list of conditions means all must match, so `[netherlands, { feature: checkout }]` narrows an override to Dutch users of the new checkout.
- Every override needs a unique `key`, `conditions`, and exactly one of `value` or `mutate`.
- Conditions take every leaf kind: segments, attributes, features and variables ([conditions.md](conditions.md)).
- A catch-all `conditions: '*'` must be last.
- With environments configured, put each list under its environment key.

### Change part of a structured value

`value` replaces the whole value. `mutate` changes paths and keeps the rest:

```yaml
description: Checkout settings

type: object

properties:
  currency:
    type: string
  paymentMethods:
    type: array
    items:
      type: string

defaultValue:
  currency: EUR
  paymentMethods: [card]

overrides:
  - key: netherlands
    conditions: netherlands
    mutate:
      paymentMethods: [ideal, paypal]
```

Paths in `mutate` are relative to the variable. Array operations such as `paymentMethods:appendUnique` and `paymentMethods:removeValue` are listed in [variables-schemas.md](variables-schemas.md#mutations). Write `mutate` as a list of single entry maps when order matters or a path repeats.

### Nested overrides

A child override is checked only after its parent matches, and its `mutate` starts from the parent's value:

```yaml
overrides:
  - key: netherlands
    conditions: netherlands
    mutate:
      paymentMethods: [ideal, paypal]
    overrides:
      - key: amsterdam
        conditions:
          - attribute: city
            operator: equals
            value: amsterdam
        mutate:
          'paymentMethods:appendUnique': cash
```

| Context             | `paymentMethods`        |
| ------------------- | ----------------------- |
| German              | `[card]`                |
| Dutch, in Rotterdam | `[ideal, paypal]`       |
| Dutch, in Amsterdam | `[ideal, paypal, cash]` |

Keys are unique across the whole tree. Evaluations report the final `variableOverrideKey` and its `variableOverridePath`, such as `[netherlands, amsterdam]`.

### Accumulating overrides

By default the first match wins. `continue: true` on an override lets later matching overrides in the same list keep changing the value:

```yaml
description: Activities available to the current user

type: array

items:
  type: string

defaultValue: []

overrides:
  - key: paid
    conditions:
      attribute: plan
      operator: equals
      value: paid
    continue: true
    value: [likePosts, commentOnPosts, createPosts]

  - key: posting-grant
    conditions:
      attribute: postingGrant
      operator: equals
      value: true
    mutate:
      ':appendUnique': createPosts
```

A paid user with the grant gets `[likePosts, commentOnPosts, createPosts]`, without a duplicate. A free user with the grant gets `[createPosts]`. On an array variable itself, the path is empty, so the key is `:appendUnique`. Evaluations list every matched step in `variableOverridePaths`, and `npx featurevisor evaluate --explain` shows the operations applied.

Accumulating overrides need SDKs that support override programs. Check every consumer against the [SDK compatibility matrix](https://featurevisor.com/docs/sdks/compatibility/) before publishing them. Lint explores the reachable states of an accumulating tree, up to 4096. If it cannot prove a tree valid, simplify it or split the variable.

## Gate the whole variable

Root `conditions` apply to the variable itself:

```yaml
description: Help text in the new checkout

type: string

defaultValue: Need help? Chat with us

conditions:
  - feature: checkout
  - variable: maintenanceMode
    operator: equals
    value: false

disabledValue: Need help? Email us
```

While the gate is unmet, the variable returns `disabledValue`, or `defaultValue` with `useDefaultWhenDisabled: true`, or `null`, with reason `conditions_unmet`. Compare `maintenanceMode` with `false` rather than wrapping `equals: true` in `not`, so a missing value also keeps the text off.

## Compose values

`compose` builds a global variable from other evaluated values. Every consumer must run a v4 SDK before compositions are published ([compatibility](https://featurevisor.com/docs/sdks/compatibility/#composition-support)).

### Alias

```yaml
description: Support address for checkout

compose: supportEmail
```

The alias returns `supportEmail`'s evaluated value directly, with the same type, targeting, gates, sticky values and modules. Read it with the source's getter, such as `getVariableString('checkoutSupport', context)`. The string is the exact global key. Dots and slashes are literal parts of it, not paths.

**Rename a global variable** without breaking consumers: move the definition to `newKey.yml` and leave an alias at the old key while applications migrate.

```yaml
description: Previous key, use newKey

compose: newKey

deprecated: true
```

SDKs log deprecation diagnostics for callers still reading the old key, and lint warns with `deprecated_reference` where a definition still uses it. Archive the alias once nothing reads it.

### Collect several values into one object

```yaml
description: Everything the checkout page reads

compose:
  enabled: { feature: checkout }
  pricing: { feature: pricing, variation: true }
  label: { feature: buyButton, variable: label }
  support: { variable: supportEmail }
```

The four reference forms read a flag, a variation, a feature variable and a global variable. `variation: true` reads the selected variation, and that feature must declare variations or a `disabledVariationValue`. Each member comes from its source's normal getter, including bucketing and disabled fallbacks. A `false` flag or `null` member stays in the object and does not affect its siblings. Read the result with `getVariable` or `getVariableObject`.

Compositions nest: a member can reference another composition. Lint rejects cycles.

**Every member is evaluated eagerly**, so reading the composition can expose a user to every experiment it references, even members the application does not render. Only compose values consumed together.

### Rules for compositions

- Allowed fields: `description`, `compose`, `conditions`, `disabledValue`, `overrides`, `tags`, `deprecated`, `archived`, `promotable`.
- Not allowed: `type` or other schema fields, `defaultValue`, `useDefaultWhenDisabled`, root `mutate`. The sources define the result's type, and lint checks `disabledValue` against it.
- Property names cannot be empty, `__proto__`, `prototype` or `constructor`.
- An unmet root gate returns `disabledValue` or `null`, without reading any source or running overrides.
- Overrides run after all sources, with the ordinary rules: keys, first match, nesting, `continue`, `value` or `mutate`. A whole `value` must match the inferred shape exactly.

### Composition warnings

Both are advisory lint warnings.

- `composition_experiment_override`: an override may change a value that comes from an experiment, so the final value can differ from the user's assignment. Change the original experiment instead when the change belongs to it.
- `composition_nullable_mutation`: a mutation may walk into a source that can be `null`, such as a feature variable while its feature is disabled. Add a fallback to the source, or guard the override with a condition on the same source, such as `{ variable: settings, operator: notNull }`.

## Evaluation order

1. A whole variable sticky value.
2. Root `conditions`. When unmet: `disabledValue`, `defaultValue` with `useDefaultWhenDisabled`, or `null` (`conditions_unmet`). A composition skips its sources and overrides.
3. Composition sources, if `compose` is present.
4. Overrides, in order, following nesting and `continue` (`variable_override_rule`).
5. Otherwise the default (`variable_default`) or the composed object (`variable_composed`).

## Test

Global variable specs live in `tests/variables/`. Global variables are not bucketed, but `at` fixes the bucket for features reached through conditions or a composition.

```yaml
variable: supportEmail

assertions:
  - key: nl
    description: Dutch users reach the local desk
    context:
      country: nl
    expectedValue: support-nl@example.com
    expectedEvaluation:
      reason: variable_override_rule
      variableOverrideKey: netherlands

  - key: maintenance
    description: Maintenance sends everyone to the status page
    context:
      country: nl
    stickyVariables:
      maintenanceMode: true
    expectedValue: status@example.com
```

Assertions also accept `stickyFeatures`, `checks`, `children`, `matrix` and `target`. See [testing.md](testing.md#global-variable-specs).

## Inspect

```bash
npx featurevisor evaluate --variable=supportEmail --context='{"country":"nl"}' --explain
npx featurevisor find-usage --variable=supportEmail
```

The explanation names the matched override and its path. For a composition it lists each member's source and value, after overrides. `find-usage` lists what the variable depends on and which features and variables reference it. Search application code separately for SDK reads.

## Read in an application

```js
f.getVariable('supportEmail', context)
f.getVariableString('supportEmail', context)
f.evaluateVariable('supportEmail', context) // details: reason, variableOverrideKey
```

The two argument form reads a global variable, and the three argument form `getVariable(featureKey, variableKey, context)` reads a feature variable. Go, Rust and Elixir have separate `GetGlobalVariable` or `get_global_variable` functions ([sdk-other-languages.md](sdk-other-languages.md#global-variables)).

## Targets, tags and retirement

A target without selectors includes every active global variable. Targets that select by tag include only global variables carrying that tag, and `includeVariables` and `excludeVariables` select by key ([targets.md](targets.md)). A target always includes whatever its selected definitions reference.

Retire a global variable in two steps: `deprecated: true` while code still reads it, then `archived: true` once nothing does. Lint rejects a reference to an archived global variable from any definition, spec or target that is not archived itself, so remove those references and delete its specs in the same change. Keep the archived file so the key is not reused.
