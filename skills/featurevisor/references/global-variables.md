# Global variables

Full docs: <https://featurevisor.com/docs/global-variables>

Global variables live under `variables/` and are evaluated independently from features. Do not confuse them with feature variables under `variablesSchema`.

Use a global variable for configuration with its own lifecycle and targeting that does not need percentage rollout. Use a feature variable when the value belongs to one feature, follows a variation, or needs bucketing and gradual rollout. Global variables are deterministic for the same context and datafile.

```yaml
description: Support email
tags: [all]
type: string
defaultValue: support@example.com
overrides:
  production:
    - key: netherlands
      conditions:
        attribute: country
        operator: equals
        value: nl
      value: support-nl@example.com
    - key: default
      segments: "*"
      value: support@example.com
```

Schema fields match feature `variablesSchema`. Define `type` and related fields inline, use `oneOf` for several valid schema branches, or use `schema` to reference a reusable schema. Never combine these root forms.

`overrides` follows the same environment rule as feature `rules` and `force`: a map keyed by environment when the project declares `environments`, and a direct list of overrides when it does not. The example above assumes environments.

Every override requires a stable `key`, at least one selector from `segments`, `conditions`, or `requiredFeatures`, and exactly one of `value` or `mutate`. Conditions and segments cannot appear together. Required features may appear alone or with either other selector, using AND semantics. A plain `segments: "*"` catch-all without requirements must be last.

`mutate` paths are relative to the variable root and are resolved while building the datafile.

Global variable overrides may contain nested `overrides`. The first matching sibling wins at every level. Child selectors are combined with their ancestors using AND semantics, and child mutations start from the parent's resolved value. The builder flattens the tree into complete values, so SDKs do not mutate values at runtime. Keep every override key unique across the complete tree for one environment. Detailed evaluations expose the final `variableOverrideKey`; flattened descendants also expose the complete `variableOverridePath`.

Nested overrides are only available for global variables. Feature variable overrides inside rules and variations remain flat.

Use `requiredFeatures` at the variable or override level. A direct feature key is accepted for one enabled requirement. Arrays accept feature keys or `{ feature, enabled?, variation? }` objects. `enabled` defaults to `true` and honours `isEnabled()`. `variation` honours `getVariation()`, including `disabledVariationValue`. For a global variable, unmet requirements return `disabledValue`, or `defaultValue` when `useDefaultWhenDisabled: true`, and the detailed evaluation reports `reason: required_features_unmet`. That is the string to look for in `featurevisor evaluate --verbose` when a global variable returns an unexpected fallback.

Feature `expose` configuration controls datafile presence. Requirement checks use SDK results directly, so an omitted feature normally fails the default enabled check and can satisfy an explicit `enabled: false` check.

Targets select global variables by `tag` or `tags`, plus optional glob-like `includeVariables` and `excludeVariables` selectors. Tag and include or exclude selectors use AND semantics. A Target without selectors includes every active feature and global variable.

JavaScript evaluation:

```js
f.getVariable('supportEmail', context)
f.evaluateVariable('supportEmail', context)
f.setStickyVariables({ supportEmail: 'fixed@example.com' })
```

The feature variable form remains `f.getVariable(featureKey, variableKey, context)`.

Tests live under `tests/variables/`:

```yaml
variable: supportEmail
assertions:
  - environment: production
    context: { country: nl }
    expectedValue: support-nl@example.com
    expectedEvaluation:
      reason: variable_override_rule
      variableOverrideKey: netherlands
      variableOverrideIndex: 0
```

Variable assertions also support `target`, `matrix`, `at`, `stickyFeatures`, `stickyVariables`, `defaultVariableValue`, and `children`.

Global variables are not bucketed. In a variable assertion, `at` sets the 0 to 100 bucket position only for feature evaluations reached through `requiredFeatures`. It is a no-op when no required feature is evaluated. A number applies throughout the required feature chain. Use `stickyFeatures` to supply exact upstream flag, variation, and feature variable results per feature. Sticky features take precedence over `at` for those feature keys. Use `stickyVariables` separately to fix the global variable's own result.

Matrix placeholders are substituted recursively in `at`, nested sticky values, defaults, expected values, detailed evaluation expectations, and child assertions. Complete placeholders preserve structured arrays and objects. Matrices and their axes must be nonempty, every placeholder must name a declared matrix key, and matrix driven environments and Targets must exist. `at` must be a number from 0 to 100 or a complete matrix placeholder backed by values in that range. Detailed expectations accept only documented evaluation fields, must contain at least one field, and compare nested arrays and objects by value.

Child assertions evaluate through a spawned SDK child. They inherit parent context, keep sticky feature and variable maps isolated, and continue using the parent's `at` setting. Give every child at least one of `expectedValue` or `expectedEvaluation`.

A Target assertion must use the exact Target datafile. It must fail when that datafile is unavailable rather than silently evaluating the base datafile. The Node.js matrix expander removes the authoring `matrix` property before delegated language runners receive expanded assertions.

Test linting validates sticky feature keys, static variations, feature variable keys, and sticky global variable keys. Matrix values used by `at` must be numeric and between 0 and 100. Matrix values used by sticky `enabled` and `variation` fields must retain their boolean and string types respectively.
