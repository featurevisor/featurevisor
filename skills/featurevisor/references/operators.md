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
- Nested object attributes use dot-paths in `attribute`: `attribute: account.plan`. Comparing an object attribute directly is a lint error — use a nested path, or `exists`/`notExists`.

## Portable conditions (cross-SDK subset)

Conditions must evaluate identically in every Featurevisor SDK — JavaScript, Go, Python, Ruby, Java, Swift, PHP ([sdk-other-languages.md](sdk-other-languages.md)). Lint therefore enforces a portable subset. These are the rules agents most often trip over:

### Dates: full ISO 8601 with an explicit timezone

`before`/`after` values must be a complete timestamp **with a timezone offset**. Date-only values and timestamps without a zone are rejected.

```yaml
# valid
value: "2026-11-27T00:00:00Z"
value: "2026-11-27T01:00:00+01:00"
value: "2026-11-27T00:00:00.250Z"

# rejected by lint
value: "2026-11-27"           # date only
value: "2026-11-27T00:00:00"  # no timezone
```

Lint error: `when operator is "after", value must be a stringified date in ISO 8601 format`.

Quote date values in YAML. Unquoted, YAML parses them into its own timestamp type, which sidesteps the string check and can round-trip differently — quoting keeps what you wrote.

**The same format applies to the value the application passes in context** — and this side fails *silently*. A context value that isn't a full timestamp with timezone (or a real `Date`) makes the condition simply not match, so evaluation falls through to the next rule with no error anywhere:

```js
f.isEnabled('promoBanner', { date: new Date() })                  // ✅ Date object
f.isEnabled('promoBanner', { date: '2026-11-28T10:00:00Z' })      // ✅ full ISO 8601
f.isEnabled('promoBanner', { date: '2026-11-28' })                // ❌ never matches
```

When someone reports "my date-windowed feature never turns on", check the context value's format first — `npx featurevisor evaluate --context='{…}'` reproduces it in seconds.

### Regex: portable flags and syntax

`matches`/`notMatches` accept a `regexFlags` sibling containing unique characters from the cross-SDK set **`g`, `i`, `m`, `s`** only (`d`, `u`, `v`, `y` are rejected). Cached regular expressions behave like a fresh one for each evaluation.

Supported: character classes, anchors, alternation, **capturing** groups, escaped literals, ordinary quantifiers.

Rejected by lint — every one of these is a lint error:

```
foo(?=bar)      lookahead
(?<=foo)bar     lookbehind
(?:foo|bar)     non-capturing group   ← the common surprise; use (foo|bar)
(?<name>foo)    named group
(foo)\1         backreference
foo++           possessive quantifier
```

Any `(?` construct at all is rejected. Lint errors read `value must not use lookaround, named groups, noncapturing groups, atomic groups, or inline mode groups in the cross-SDK regex subset` and `regexFlags must contain unique characters from the cross-SDK set: g, i, m, s`.

### Semver

Standard semver strings, including prerelease and build metadata: `1.2.3`, `1.2.3-beta.1`, `1.2.3+build.5`. A value that isn't valid semver produces a `condition_match_error` diagnostic at evaluation time rather than a match.

### Operator ↔ attribute type

Lint cross-checks each operator against the attribute's declared type:

| Operators                                                  | Allowed attribute types      |
| ---------------------------------------------------------- | ---------------------------- |
| `greaterThan`, `greaterThanOrEquals`, `lessThan`, `lessThanOrEquals` | `integer`, `double`  |
| `contains`, `notContains`, `startsWith`, `endsWith`, `matches`, `notMatches` | `string`, `semver`, `date` |
| `semver*`                                                  | `string`, `semver`           |
| `before`, `after`                                          | `string`, `date`             |
| `in`, `notIn`                                              | primitive-valued attributes  |
| `includes`, `notIncludes`                                  | `array` of primitives        |

Values are also validated against the attribute's schema (`enum`, `pattern`, `minimum`, …), so a typo'd enum value fails lint instead of silently never matching.

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

# regex (portable subset: no (?...) constructs, flags from gims)
- attribute: email
  operator: matches
  value: ^[a-zA-Z0-9._%+-]+@example\.com$
  regexFlags: i

# semver
- attribute: appVersion
  operator: semverGreaterThanOrEquals
  value: 5.5.0

# date (quoted, full ISO 8601 with timezone)
- attribute: signupDate
  operator: after
  value: "2025-01-01T00:00:00Z"

# existence
- attribute: trialEndsAt
  operator: exists
```
