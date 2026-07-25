# Condition operators

Full docs: <https://featurevisor.com/docs/segments#operators>

Used in segment `conditions`, feature `force[].conditions`, and `variableOverrides[].conditions`.

| Operator                    | Attribute type    | Description                        |
| --------------------------- | ----------------- | ---------------------------------- |
| `exists`                    | any               | attribute is present in context    |
| `notExists`                 | any               | attribute is absent from context   |
| `equals`                    | any               | strict equality                    |
| `notEquals`                 | any               | strict inequality                  |
| `greaterThan`               | integer, double   | `>`                                |
| `greaterThanOrEquals`       | integer, double   | `>=`                               |
| `lessThan`                  | integer, double   | `<`                                |
| `lessThanOrEquals`          | integer, double   | `<=`                               |
| `contains`                  | string            | substring                          |
| `notContains`               | string            | not substring                      |
| `startsWith`                | string            | prefix                             |
| `endsWith`                  | string            | suffix                             |
| `in`                        | string            | in array of strings                |
| `notIn`                     | string            | not in array of strings            |
| `before`                    | date / ISO string | date before                        |
| `after`                     | date / ISO string | date after                         |
| `matches`                   | string            | regex (use `regexFlags` for flags) |
| `notMatches`                | string            | regex negated                      |
| `semverEquals`              | string (semver)   | `=`                                |
| `semverNotEquals`           | string (semver)   | `!=`                               |
| `semverGreaterThan`         | string (semver)   | `>`                                |
| `semverGreaterThanOrEquals` | string (semver)   | `>=`                               |
| `semverLessThan`            | string (semver)   | `<`                                |
| `semverLessThanOrEquals`    | string (semver)   | `<=`                               |
| `includes`                  | array of strings  | array contains the value           |
| `notIncludes`               | array of strings  | array does not contain the value   |

## Notes

- `equals`/`notEquals` work on any scalar; for arrays/objects prefer the dedicated operators.
- `in`/`notIn` are for matching a string attribute against a list of allowed values.
- `includes`/`notIncludes` check that an array attribute contains a given scalar.
- Dates accept ISO 8601 strings (e.g. `2025-12-25T00:00:00Z`). The `date` attribute type stores ISO strings.
- `matches`/`notMatches` accept a `regexFlags` sibling. Flags may contain unique characters from the cross-SDK set `gims`, such as `regexFlags: i` for case insensitive matching. Cached regular expressions behave like a fresh regular expression for each evaluation.
- Keep patterns portable across SDK runtimes. Character classes, anchors, capturing groups, alternation, escaped literals, and ordinary quantifiers are supported. Do not use lookaround, backreferences, named or noncapturing groups, atomic groups, inline mode groups, or possessive quantifiers. `npx featurevisor lint` rejects these constructs.
- Nested object attributes use dot-paths in `attribute`: `attribute: account.plan`.

## Example: each operator

```yaml
# numeric
- attribute: age
  operator: greaterThanOrEquals
  value: 18

# string membership
- attribute: country
  operator: in
  value: [be, nl, lu]

# array membership
- attribute: permissions
  operator: includes
  value: write

# regex
- attribute: email
  operator: matches
  value: ^[a-zA-Z0-9._%+-]+@example\.com$
  regexFlags: i

# semver
- attribute: appVersion
  operator: semverGreaterThanOrEquals
  value: 5.5.0

# date
- attribute: signupDate
  operator: after
  value: 2025-01-01T00:00:00Z

# existence
- attribute: trialEndsAt
  operator: exists
```
