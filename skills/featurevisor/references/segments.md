# Segments reference

Full docs: <https://featurevisor.com/docs/segments>

Segments are reusable named conditions. They live in `segments/<key>.yml` and are referenced from feature rules.

For the list of operators, see [operators.md](operators.md).

## Minimum segment

```yaml
description: Users from The Netherlands
conditions:
  - attribute: country
    operator: equals
    value: nl
```

## Conditions

A single condition has:

- `attribute` — name of the attribute defined under `attributes/` (use dot-paths for nested object attributes, e.g. `account.plan`)
- `operator` — see [operators.md](operators.md)
- `value` — type depends on operator (string, number, array, ISO date string, semver string, regex string)
- `regexFlags` — only for `matches` / `notMatches`

Multiple sibling conditions are implicitly `and`-ed:

```yaml
conditions:
  - attribute: country
    operator: equals
    value: us
  - attribute: device
    operator: equals
    value: iPhone
```

Equivalent explicit form:

```yaml
conditions:
  and:
    - attribute: country
      operator: equals
      value: us
    - attribute: device
      operator: equals
      value: iPhone
```

### or

```yaml
conditions:
  or:
    - attribute: country
      operator: equals
      value: us
    - attribute: country
      operator: equals
      value: ca
```

### not

```yaml
conditions:
  not:
    - attribute: country
      operator: equals
      value: us
```

### Nested combinations

```yaml
conditions:
  - and:
      - attribute: device
        operator: equals
        value: iPhone
  - or:
      - attribute: country
        operator: equals
        value: us
      - attribute: country
        operator: equals
        value: ca
  - not:
      - attribute: kyc
        operator: equals
        value: pending
```

Arbitrarily deep nesting is allowed.

### Targeting everyone

```yaml
description: Everyone
conditions: '*'
```

Equivalent shorthand to a segment whose conditions always match.

## Authoring tips

- **Reuse first.** Before authoring a new segment, run `npx featurevisor list --segments --json --pretty` and `npx featurevisor find-duplicate-segments` to see if one exists. Reusing existing segments keeps targeting consistent across features.
- **Name by intent**, not by definition. `proAccounts` beats `planEqualsPro` — definitions change, intent doesn't.
- **Prefer narrow segments composed in rules** over one mega-segment. Rules can `and`/`or`/`not` multiple segment names ([features.md](features.md#segments-in-rules)) — composing at the rule level keeps each segment reusable.
- After creating or editing a segment, run `npx featurevisor lint`.

## Archiving

```yaml
archived: true
description: Users from The Netherlands
conditions:
  - attribute: country
    operator: equals
    value: nl
```

Archived segments cannot be referenced by features (lint will catch any reference).
