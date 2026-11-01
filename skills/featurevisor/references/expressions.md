# Condition expressions

Full docs: <https://featurevisor.com/docs/expressions/>

A condition expression writes [conditions](conditions.md) as text, such as `country == 'nl' and plan == 'paid'`. The CLI turns each one into the tree it stands for as it reads the project, so lint, tests, builds, datafiles and every SDK see trees. Expressions are authoring only.

## Match the project

Expressions are opt in. A project writes them only when `featurevisor.config.js` sets `allowConditionExpressions: true`. Check it with `npx featurevisor config --json`:

- **On, and files use expressions:** write new conditions as expressions, in the style of the files around them.
- **Off:** write trees. Lint reports every expression with `expression_not_allowed`. Do not turn the option on unless the user asks.

To move a whole project, use `convert` rather than editing files by hand (see [Commands](#commands)). Every CLI that lints or builds the project must be new enough to read expressions. An older CLI reads one as an unknown segment: its lint fails, and a build that skips lint gets the condition wrong.

## Write a condition

Any string in `conditions` can be an expression: the whole value, a list item, or a child of `and`, `or` and `not`. A string is read by its shape. `'*'` matches everyone, a string shaped like a segment key, such as `netherlands` or `countries.netherlands`, names that segment, and any other string is an expression.

```yaml
conditions: country == 'nl'
```

More than one condition goes in a `|` block, one condition a line, as `fmt` writes it:

```yaml
conditions: |
  netherlands
  and (
    # Paying accounts, or any account with 50+ seats
    payingAccounts
    or account.seats >= 50
  )
```

| Leaf                    | Expression                                               |
| ----------------------- | -------------------------------------------------------- |
| Attribute               | `country == 'nl'`, `account.seats >= 50`                 |
| Segment                 | `netherlands`, a name on its own                         |
| Feature enabled         | `feature('liveChat')`                                    |
| Feature disabled        | `feature('liveChat') == false`                           |
| Variation               | `feature('pricing').variation == 'control'`              |
| Feature variable        | `feature('buyButton').label == 'Buy now'`                |
| Global variable         | `variable('maintenanceMode') == false`                   |
| Variable path           | `variable('checkoutSettings').currency == 'EUR'`         |
| Key with odd characters | `variable('checkoutSettings')['limits.v2'][0].quota > 5` |

- `==`, `!=`, `>`, `>=`, `<` and `<=` compare. Every other operator keeps its own name between the subject and the value: `plan in ['paid', 'enterprise']`, `email endsWith '@example.com'`, `permissions includesAny ['write', 'admin']`. Presence and emptiness operators follow the subject with no value: `userId exists`, `permissions notEmpty`.
- Strings use single quotes, with `\'`, `\\`, `\n`, `\t` and `\uXXXX` escapes. Numbers are written as in JSON. A list holds one type, with `null` allowed beside it.
- Versions compare with `semver(...)`: `version >= semver('5.5.0')`. Without it, `==` compares text.
- Timestamps are text compared with `before` and `after`: `signupDate after '2026-01-01T00:00:00Z'`.
- Patterns follow `matches` or `notMatches` as literals with flags: `account.locale matches /^(nl|be)-/i`.
- `and`, `or` and `not` are lowercase. `not` binds tightest, then `and`, then `or`. Use parentheses when mixing `and` and `or`, since lint warns without them.
- A comment is a whole line starting with `#`.
- A variable always needs a comparison. `variable('maintenanceMode')` alone is a lint error.

## Missing values

An expression matches a missing value exactly as its tree does. `not` turns any answer around, including a missing value's, so `not plan in ['enterprise']` matches a context without a `plan`, while `plan notIn ['enterprise']` does not. Lint warns where they differ. Choose deliberately.

## What stays a tree

- A disabled feature's variation, `{ feature: pricing, enabled: false, variation: control }`, has no expression form. Keep it as a tree item beside expressions.
- `and`, `or`, `not`, `true`, `false` and `null` are words of the language, so an attribute or segment with one of those keys must be written as a tree.
- Expressions say only what a tree can: no arithmetic, and no comparison between two attributes.

## Common mistakes

Lint reports each at its file, line and column, with a hint.

| Written                         | Write                                                  |
| ------------------------------- | ------------------------------------------------------ |
| `country = 'nl'`                | `country == 'nl'`                                      |
| `plan == "paid"`                | `plan == 'paid'`                                       |
| `a && b`, `a \|\| b`, `!a`      | `a and b`, `a or b`, `not a`                           |
| `country in ('nl', 'de')`       | `country in ['nl', 'de']`                              |
| `plan not in ['free']`          | `plan notIn ['free']`                                  |
| `seats between 1 and 5`         | `seats >= 1 and seats <= 5`                            |
| `version >= '5.5.0'`            | `version >= semver('5.5.0')`                           |
| `feature('liveChat').enabled`   | `feature('liveChat')`, which reads its enabled state   |
| `segment('netherlands')`        | `netherlands`                                          |
| `liveChat` alone, for a feature | `feature('liveChat')`, since a name alone is a segment |

## Commands

- `npx featurevisor fmt` writes expressions in one style, one condition a line, in a project that allows them. It never turns a tree into an expression.
- `npx featurevisor convert --to=expressions` writes every tree that has an exact expression form as one, and turns the option on. `--to=trees` writes every expression back as a tree and turns it off. Both preview without `--apply`, and write only once a converted copy lints, tests and builds byte identical datafiles. They rewrite the whole project, so show the preview and apply on the user's go ahead.
- `npx featurevisor fmt --simplify` writes each condition in its simplest form that evaluates the same, such as a list of one condition as that condition, and joins expressions side by side into one. Datafiles change shape but evaluate the same, so show `fmt --simplify --diff` first and apply on the user's go ahead.
- `evaluate --explain` prints conditions as expressions in a project that allows them, and `diff` treats an expression and its tree as the same condition.
