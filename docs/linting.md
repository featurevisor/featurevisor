---
title: Linting
description: Lint your Featurevisor definition files
---

Featurevisor provides a CLI command to lint your definition files, making sure they are all valid and won't cause any issues when you build your datafiles. {% .lead %}

## Usage

Run:

```
$ npx featurevisor lint
```

And it will show you the errors in your definition files, if any.

If any errors are found, it will terminate with a non-zero exit code.

## Validation Rules

### Feature Rules

The linter prevents duplicate segments within feature rules to avoid redundant targeting:

```yml
# Invalid: Duplicate segment in rule
environments:
  production:
    rules:
      - key: "1"
        segments:
          - foo
          - bar
          - foo  # Error: Duplicate segment
        percentage: 100

# Invalid: Duplicate segment in force rule
environments:
  production:
    force:
      - segments:
          - foo
          - bar
          - foo  # Error: Duplicate segment
```

### Segment Conditions

The linter enforces several rules for segment conditions to prevent redundant or conflicting conditions. These rules help maintain clean and logical segment definitions while still allowing flexibility for valid business cases.

1. **AND Conditions**:
   - Cannot have the same attribute with the same operator multiple times (prevents redundant conditions)
   - Valid: Using same attribute with different operators (e.g., for range checks)
   ```yml
   # Invalid: Same attribute + operator (redundant)
   and:
     - attribute: country
       operator: equals
       value: "US"
     - attribute: country
       operator: equals
       value: "CA"

   # Valid: Same attribute, different operators (range check)
   and:
     - attribute: age
       operator: greaterThan
       value: 18
     - attribute: age
       operator: lessThan
       value: 65
   ```

2. **OR Conditions**:
   - Allows duplicate attributes and operators
   - Useful for handling multiple valid values or different data formats
   - Common use case: Supporting both string and number formats for version checks
   ```yml
   # Valid: Multiple formats for same attribute
   or:
     - attribute: version
       operator: equals
       value: 5.5      # number format
     - attribute: version
       operator: equals
       value: "5.5"    # string format
   ```

3. **NOT Conditions**:
   - Cannot have duplicate attributes at all
   - This prevents redundant or potentially conflicting negations
   - Use OR/AND conditions instead for multiple exclusions
   ```yml
   # Invalid: Same attribute used multiple times in NOT
   not:
     - attribute: device
       operator: equals
       value: "mobile"
     - attribute: device
       operator: equals
       value: "tablet"

   # Better approach: Use OR condition
   not:
     - or:
         - attribute: device
           operator: equals
           value: "mobile"
         - attribute: device
           operator: equals
           value: "tablet"
   ```

These validation rules are enforced during the linting process to help catch potential issues early in your development workflow.

## CLI options

### `keyPattern`

You can also filter keys using regex patterns:

```
$ npx featurevisor lint --keyPattern="myKeyHere"
```

### `entityType`

If you want to filter it down further by entity type:

```
$ npx featurevisor lint --keyPattern="myKeyHere" --entityType="feature"
```

Possible values for `--entityType`:

- `attribute`
- `segment`
- `feature`
- `group`
- `test`

## NPM scripts

If you are using npm scripts for linting your Featurevisor project like this:

```js
// package.json

{
  "scripts": {
    "lint": "featurevisor lint"
  }
}
```

You can then pass your options in CLI after `--`:

```
$ npm run lint -- --keyPattern="myKeyHere"
```
