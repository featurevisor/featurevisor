# Operators

Full docs: <https://featurevisor.com/docs/operators/>

Operators apply to attribute and variable leaves in [conditions](conditions.md), and to [test checks](testing.md#checks). Feature leaves have no operator: they use `enabled` and `variation`.

## By type

| Operator                                                                                                                        | Works on                    | Matches when                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `equals`, `notEquals`                                                                                                           | strings, numbers, booleans  | strictly equal, or not. `notEquals` also matches a missing value |
| `greaterThan`, `greaterThanOrEquals`, `lessThan`, `lessThanOrEquals`                                                            | `integer`, `number`         | numeric comparison                                               |
| `contains`, `notContains`, `startsWith`, `endsWith`                                                                             | `string`                    | text comparison                                                  |
| `matches`, `notMatches`                                                                                                         | `string`                    | portable regular expression, optional `regexFlags`               |
| `in`, `notIn`                                                                                                                   | `string` attribute          | value is in the list of strings, or not                          |
| `includes`, `notIncludes`                                                                                                       | `array`                     | array contains the value, or not                                 |
| `includesAny`, `notIncludesAny`                                                                                                 | `array`                     | array contains any candidate, or none                            |
| `before`, `after`                                                                                                               | timestamp strings           | strictly before or after the timestamp                           |
| `semverEquals`, `semverNotEquals`, `semverGreaterThan`, `semverGreaterThanOrEquals`, `semverLessThan`, `semverLessThanOrEquals` | version strings             | version comparison                                               |
| `exists`, `notExists`                                                                                                           | any                         | present in context, or absent                                    |
| `isNull`, `notNull`                                                                                                             | any                         | explicit `null`, or present and not null                         |
| `empty`, `notEmpty`                                                                                                             | `string`, `array`, `object` | shallow size is zero, or not                                     |

`exists`, `notExists`, `isNull`, `notNull`, `empty` and `notEmpty` take no `value`.

## What lint checks

Lint compares each operator with the declared attribute or variable type:

- `in` and `notIn` on attributes need a `string` attribute, including nested paths, and a list of strings. For numbers, put `equals` leaves in an `or` group. In variable conditions the list may also hold numbers and `null`, never booleans. Compare booleans with `equals`.
- Numeric operators need `integer` or `number`. Text operators need `string`.
- A `string` with `format: date-time` takes only `before`, `after`, `exists`, `notExists`, `isNull` and `notNull`. To compare a timestamp as text too, declare a plain `string`.
- `semver*` values must be versions the operators can compare.
- `includesAny` and `notIncludesAny` on attributes need a string array, and each candidate must match the item constraints, including enums.
- Values must satisfy the attribute's schema, so a misspelled enum value fails lint instead of never matching.
- Operators listed in the project's `disallowOperators` are rejected.

## Missing values

When the attribute or path is missing, most operators return `false`, including negative ones such as `notIn`, `notContains` and `notMatches`. The exceptions:

- `notEquals` and `notExists` return `true`.
- `not` around another operator turns its `false` into `true`. So `not` around `empty` matches a missing value while `notEmpty` does not, and `not` around `isNull` matches a missing value while `notNull` does not.

Prefer the direct negative operator over a `not` group when missing values should not match.

## Dates

`before` and `after` take `YYYY-MM-DDTHH:mm:ss` with `Z` or an offset such as `+02:00`, and an optional fraction of one to nine digits. Quote them.

```text
valid:     '2026-11-27T00:00:00Z'
valid:     '2026-11-27T01:00:00+01:00'
valid:     '2026-11-27T00:00:00.250Z'
rejected:  '2026-11-27'            no time
rejected:  '2026-11-27T00:00:00'   no timezone
```

Lint message: `when operator is "before", use an ISO 8601 timestamp YYYY-MM-DDTHH:mm:ss with Z or ±HH:mm and optional 1 to 9 fractional digits`.

- Both operators are strict. To include a launch at `2026-11-27T00:00:00Z`, use `after` with `'2026-11-26T23:59:59.999Z'`.
- Fractions are truncated to milliseconds. Offsets cannot exceed 14 hours. Years run from 0001 to 9999.
- Featurevisor has no clock. The application passes the current time in context, as a timestamp string or a native date such as a JavaScript `Date`. See the [scheduled releases recipe](recipes.md#scheduled-releases-and-time-windows).
- A missing or invalid date in context makes both operators `false`. `not` can turn that into `true`, so do not use `not` around `after` as a substitute for `before`.
- Native inputs vary by SDK. Ruby takes `Time` or `DateTime`, not `Date`. Java takes `Instant`, `java.util.Date`, `OffsetDateTime` or `ZonedDateTime`. Go's zero `time.Time{}` is a real instant in year 0001, so omit the key when the date is unknown. See the [native types table](https://featurevisor.com/docs/operators/#native-date-values).

When someone reports "my date windowed feature never turns on", check the context value's format first with `npx featurevisor evaluate --context='{…}'`, which warns about values that do not match the attribute.

## Versions

Declare version attributes as `type: string` with `format: semver`, and quote versions so YAML keeps them as text: `'5.5'` would otherwise become the number 5.5.

```yaml
- attribute: appVersion
  operator: semverGreaterThanOrEquals
  value: '5.5.0'
```

- One to four numeric parts. Missing parts count as zero, so `5.5` equals `5.5.0`.
- Parts compare as numbers: `5.10.0` is greater than `5.9.0`.
- A leading `v` is accepted: `v5.5.0`.
- A prerelease sorts before its release: `5.5.0-beta.1` is less than `5.5.0`. Build metadata after `+` never affects ordering.
- A part after the first may be `x`, `X` or `*` to match any value.

Lint rejects values the operators could never compare, such as `5.5,0`: `value must be a version the operators can compare, such as 5.5.0, 5.5 or v5.5.0`. An unquoted number fails with `value must be a string. Quote versions such as '5.5' so YAML keeps them as text.` At runtime a malformed version in context is an evaluation error, even inside `not` or `or`.

## Regular expressions

`matches` and `notMatches` take a pattern in `value` and optional `regexFlags` from `g`, `i`, `m` and `s`.

```yaml
- attribute: email
  operator: matches
  value: '^[a-z0-9._%+-]+@example\.com$'
  regexFlags: i
```

Use character classes, anchors, capturing groups, alternation, escaped literals and ordinary quantifiers. Lint rejects anything that behaves differently across SDKs:

```
foo(?=bar)      lookahead
(?<=foo)bar     lookbehind
(?:foo|bar)     non-capturing group, the usual surprise: write (foo|bar)
(?<name>foo)    named group
(foo)\1         backreference
foo++           possessive quantifier
```

Lint also rejects patterns that backtrack exponentially, such as `(a+)+` or `(a|aa)+`, with `regex_backtracking`. Make each repetition start or end with a character the rest cannot match. Prefer `[0-9]` and `[A-Za-z0-9_]` when exact character classes matter.

## Arrays

```yaml
- attribute: permissions
  operator: includes
  value: write

- attribute: permissions
  operator: includesAny
  value: [write, admin]

- attribute: permissions
  operator: notIncludesAny
  value: [write, admin]
```

The second matches `[read, write]`. The third matches `[read]` and `[]`. Matching is strict, so `1` does not match `"1"`. With an empty actual or candidate array, `includesAny` is `false` and `notIncludesAny` is `true`. A missing or non array value makes both `false`. Do not replace `notIncludesAny` with `not` around `includesAny`, which would match missing values.

## Empty and present

| Value                          | `empty` | `notEmpty` |
| ------------------------------ | ------- | ---------- |
| `""`, `[]`, `{}`               | true    | false      |
| `" "`, `[null]`, `{ x: null }` | false   | true       |
| `null` or missing              | false   | false      |

`isNull` matches an explicit `null` only. `notNull` requires a present, nonnull value. `exists` is about presence in context: a present `null` exists.

## Restricting operators per project

`disallowOperators` in `featurevisor.config.js` rejects listed operators in conditions and test checks. Use it while some consuming SDK is older than an operator, for example `disallowOperators: ['includesAny', 'notIncludesAny']`. Check the [SDK compatibility matrix](https://featurevisor.com/docs/sdks/compatibility/) for each consumer. It is an authoring policy, not a compatibility mode.
