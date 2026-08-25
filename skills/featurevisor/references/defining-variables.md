# Global variables

Full docs: <https://featurevisor.com/docs/defining-variables>

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

Schema fields match feature `variablesSchema`. Define `type` and related fields inline, or use `schema` to reference a reusable schema. Never combine the two forms.

Every override requires a stable `key`, targeting through `segments`, `conditions`, or both, and exactly one of `value` or `mutate`. Segments and conditions use AND semantics when both are present. A plain `segments: "*"` catch-all must be last.

`mutate` paths are relative to the variable root and are resolved while building the datafile.

Use `requiredFeatures` at the variable or override level. Requirements can be feature keys or `{ key, variation }` objects. For a global variable, disabled means its required features were not satisfied. Unmet requirements return `disabledValue`, or `defaultValue` when `useDefaultWhenDisabled: true`.

Targets select global variables by `tag` or `tags`. Their `includeFeatures` and `excludeFeatures` selectors remain feature specific.

JavaScript evaluation:

```js
f.getGlobalVariable('supportEmail', context)
f.evaluateGlobalVariable('supportEmail', context)
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
      overrideKey: netherlands
```

Variable assertions also support `target`, `matrix`, `stickyVariables`, and `defaultVariableValue`.
