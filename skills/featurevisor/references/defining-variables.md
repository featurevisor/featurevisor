# Top-level variables

Full docs: <https://featurevisor.com/docs/defining-variables>

Top-level variables live under `variables/` and are evaluated independently from features. Do not confuse them with feature variables under `variablesSchema`.

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

Use `requiredFeatures` at the variable or override level. Requirements can be feature keys or `{ key, variation }` objects. Unmet requirements return `disabledValue`, or `defaultValue` when `useDefaultWhenDisabled: true`.

Targets select top-level variables by `tag` or `tags`. Their `includeFeatures` and `excludeFeatures` selectors remain feature specific.

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
      reason: override_matched
      overrideKey: netherlands
```

Variable assertions also support `target`, `matrix`, `stickyVariables`, and `defaultVariableValue`.
