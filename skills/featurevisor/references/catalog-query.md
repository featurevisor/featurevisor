# Querying the Catalog with FQL

The Catalog's **Query** page answers questions about a project as tables, written in FQL, a small read-only query language. It reads what is defined from the Catalog's index, and what people get by evaluating with the real SDK against the same datafiles `build` writes. A report lives in its link, so it can be shared and reopened as it was.

Query is in **beta**. The language may still change, so check the cheat sheet on the page (its **?** button) when something here does not parse.

## Turning it on

```bash
npx featurevisor catalog --with-query
npx featurevisor catalog export --with-query
npx featurevisor catalog serve --with-query
```

`--with-query` links the page from the Catalog: **Query** in the sidebar with a Beta badge, **Open in Query** under the lists of features, global variables, segments and attributes, and **Who gets this?** on each feature's and global variable's Overview. Without it, nothing links to the page, but it still answers at `/query` for anyone who visits it, so you can always link a user straight to a report.

## Linking to a report

The query lives in the URL after `#`, so it never reaches a server and a long one is never cut off:

```text
http://127.0.0.1:3000/query#q=FROM+features%0AWHERE+tags+includes+%27web%27
```

Encode it as form parameters, with `new URLSearchParams({ q: query }).toString()` in JavaScript or `urllib.parse.urlencode({"q": query})` in Python: spaces become `+` and new lines `%0A`. Under a Set it is `/sets/<set>/query#q=…`. With `--hash-router` the route sits in the fragment too, as `#/query#q=…`. When a question is better answered as a table, give the user such a link rather than pasting rows: they see live results, can sort and change them, and **Copy as Markdown** gives them the table for a pull request.

## Using the page

- **Writing.** The editor runs a report 400 milliseconds after typing stops, or at once with Cmd+Enter (Ctrl+Enter elsewhere). Ctrl+Space offers what fits at the caret: clauses, properties, reads, feature and variable keys, environments, attributes, operators for a property's type, values from the project, and test scenarios after CONTEXT.
- **Errors** list under the editor as "Line 2, column 13:" with a sentence saying what to write instead. The last good result stays below them.
- **Examples**, above the editor, holds ready questions that name the project's own team, attribute, experiment and feature. **?** opens a cheat sheet of the whole language, with examples to try. The button beside it opens a full view for wide reports.
- **Results** start with a line such as "12 rows, 36 evaluations · Audience", then the table. Keys link to their pages. Any evaluated cell opens a Why panel. **Copy link** and **Copy as Markdown** take the report away.

With a browser tool, open a report's link, wait for that line, then read the table or the errors. Without one, give the user the link.

## When to use FQL, and when the CLI

| Need                                                           | Use                                          |
| -------------------------------------------------------------- | -------------------------------------------- |
| Many definitions, people or environments at once, as one table | FQL                                          |
| Counts, grouping and sorting across the project                | FQL                                          |
| A report someone else can open, change and share               | FQL link                                     |
| Every condition, probe and bucket behind one evaluation        | `npx featurevisor evaluate --explain`        |
| Scripts, CI and anything that must be parsed                   | The CLI's `--json` output ([cli.md](cli.md)) |
| What changed between Git references                            | `npx featurevisor diff`                      |

FQL runs in the browser, not as a command, so the CLI stays the authority for automation. Both evaluate with the same SDK.

## The one rule

**A bare name is a property of the row, and a call reads what someone gets.**

```fql
FROM features
SELECT key, owner, feature(key), feature(key).variation
```

`key` and `owner` are properties, read from what is defined. `feature(key)` evaluates the row's own feature, and `.variation` its variation. `enabled`, `variation` and `value` are not properties: writing them gives an error that says which read to write instead.

## Clauses

Keywords are capitals. `FROM` comes first, the rest in any order, one a line by habit. A line starting with `#` is a comment.

| Clause                                               | Does                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `FROM features, variables`                           | A row per feature, global variable, segment or attribute. Several kinds make one list, told apart by `kind`. Left out, each row is a person |
| `WHERE tags includes 'web'`                          | Keeps rows that match, written as conditions are, with `and`, `or`, `not` and brackets                                                      |
| `CONTEXT { country: 'nl', plan: 'pro' }`             | The person every read is for. Left out, everyone                                                                                            |
| `AT 50`, `AT 10, 50, 90`                             | Places them at that point of every rollout, as test specs write `at`. Several make a row each                                               |
| `VARY country ['nl', 'de', OTHER]`                   | A row per value. May repeat, and rows multiply                                                                                              |
| `VARY [{ country: 'nl', city: 'amsterdam' }, OTHER]` | A row per person written out, each a combination, so only real combinations are evaluated                                                   |
| `ENVIRONMENT staging, production`                    | Where to read, or `*` for all. Left out, the last environment configured                                                                    |
| `SELECT key, owner AS team`                          | Columns, each with a heading `AS` gives it, quoted or one word                                                                              |
| `GROUP BY owner`                                     | Gathers rows, and `SELECT owner, count()` counts each group                                                                                 |
| `ORDER BY owner, key DESC`                           | Orders rows, `ASC` or `DESC`, by any property, read, detail or heading                                                                      |
| `LIMIT 10`                                           | The first rows only, after ordering                                                                                                         |
| `AS MATRIX`                                          | Environments across the top, a column each under every read                                                                                 |
| `AS MATRIX BY PERSON`                                | Each person across the top instead, a row per feature and environment                                                                       |

`SORT BY`, `FOR` and `at` inside CONTEXT or VARY are errors that say what to write: `ORDER BY`, `CONTEXT` and `AT`.

## Reads

| Read                                             | Gives                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `feature('checkout')`                            | On, Off, or a share such as `25%`                                |
| `feature(key)`                                   | The row's own feature, in `FROM features`                        |
| `feature('pricing').variation`                   | Its variation, or a split such as `control 50% · treatment 50%`  |
| `feature('buyButton').label`                     | One of its variables, a value per variation where they differ    |
| `feature('buyButton').settings.currency`         | A path inside an object variable, as `.name`, `[0]` or `['a.b']` |
| `variable('supportEmail')`                       | A global variable's value. `variable(key)` reads the row's own   |
| `variable('checkoutSettings').paymentMethods[0]` | A path inside it                                                 |
| `feature(key, 'staging')`                        | In an environment of its own, whatever ENVIRONMENT says          |

## Details

A detail wraps a read and gives what its evaluation says beside the answer.

| Detail                    | Gives                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `rollout(feature(key))`   | The share of the row's audience it is on for, from 0 to 100. Takes a flag read only                  |
| `rule(feature(key))`      | The key of the rule that matched, or `forced`                                                        |
| `reason(feature(key))`    | Why it evaluated as it did: `rule`, `no_match`, `conditions_unmet`, `forced`, `allocated` and others |
| `override(variable(key))` | The key of the override a value came from, for global and feature variables                          |

## People and lenses

Each read is answered in one of two ways, decided per feature by its own `bucketBy`:

- **One person.** When CONTEXT has what the feature buckets by, usually `userId`, or the report has AT, the answer is that person's exact On, Off, variation or value.
- **Audience.** Without it, a row describes everyone who matches it: a rule at 25% shows `25%`, and an experiment its split. A feature that requires another partly on reads the product of both shares.

The line above the results names the lens: Audience, One person, Exact (global variables without rollouts), or Mixed. A Mixed report says under it which attributes CONTEXT lacks, such as `deviceId`, so add them for one person's answer everywhere. A value marked **varies** changes with where someone falls in a rollout the row's person cannot be placed in, usually a feature that a global variable or another feature requires. Its Why panel names that feature, and AT or the missing attribute in CONTEXT reads one person's value.

AT puts a person at the same place in every rollout at once, as test specs do. Real users fall independently in each feature's rollout, which the audience lens shows.

**VARY** finds values itself when given none: `VARY country` takes the values the read features' conditions compare with `equals`, `notEquals`, `in` and `notIn`, through segments and required features, then adds `(any other)`. Range operators such as `semverGreaterThanOrEquals` make no rows, so name such values yourself: `VARY appVersion ['5.1.0', OTHER]`. `VARY *` does every attribute those conditions compare, except what the features bucket by, and stops before 48 rows. `VARY userId ['user-1', 'user-2']` makes a row per named user, each bucketed as an application buckets them. Values keep their type, so numbers and true or false compare as written.

**Combinations that belong together.** Several attributes in VARY, as `VARY country, city` or two VARY clauses, cross every value with every other, so London turns up in the Netherlands. When attributes depend on each other, write the people out instead:

```fql
FROM features
VARY [
  { country: 'nl', city: 'amsterdam' },
  { country: 'nl', city: 'rotterdam' },
  { country: 'gb', city: 'london' },
  OTHER
]
SELECT feature(key)
AS MATRIX BY PERSON
```

Each object is a person laid over CONTEXT, with a column for each key, and only these people are evaluated, which also keeps a report under the evaluation limit where a full cross would not be. `OTHER` is everyone the list does not name, with every key set to a value no condition mentions. A people list still crosses with other VARY clauses, such as `VARY plan ['pro', 'free']`. `AS MATRIX BY PERSON` puts each person across the top, here a row per feature with a column for each place, and needs FROM for its rows. Without a list, a WHERE can keep only real pairs, as `WHERE (country == 'nl' and city in ['amsterdam', 'rotterdam']) or (country == 'gb' and city == 'london')`, though the full cross is still evaluated first.

Completions after CONTEXT offer the project's test scenarios. Choosing one writes its context, and AT with its place.

## WHERE

WHERE is a condition expression over the row's properties, the person's attributes, `environment` and reads. Operators by type:

| Type          | Example                        | Operators                                                                                |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| Text          | `owner == 'growth-team'`       | `==` `!=` `in` `notIn` `contains` `startsWith` `endsWith` `matches` `exists` `notExists` |
| Lists         | `tags includes 'web'`          | `includes` `notIncludes` `includesAny` `empty` `notEmpty`                                |
| True or false | `deprecated == true`           | `== true` `== false`                                                                     |
| Numbers       | `usedBy == 0`                  | `==` `!=` `>` `>=` `<` `<=`                                                              |
| Dates         | `deadline before '2027-01-01'` | `before` `after` `exists` `notExists`                                                    |

A read alone, `WHERE feature(key)`, means on for everyone in the row. Under the audience lens a share is neither true nor false, so compare `rollout(feature(key))` for partial rollouts. Comparisons of properties pick rows before anything is evaluated, which keeps large projects fast and makes VARY find values only in the rows kept. A list page's filter such as `tag:web` is not FQL: the error gives the condition it means, here `tags includes 'web'`.

## Columns and rows

Without SELECT, a report shows `key`, `description`, `owner` and `tags`, with `kind` first for several kinds. When it evaluates, through CONTEXT, VARY, AT or a read elsewhere, it shows `key` and the row's own read instead. Whatever SELECT says, a report leads with what each row is about: `key`, each varied attribute in VARY's order, and `environment` when several environments make rows. A heading names a read, as `checkout enabled` or `pricing variation`, and `feature(key)` is headed `enabled`.

Without FROM, each row is a person, one for each combination CONTEXT, AT and VARY give, and SELECT is needed. Bare names are the person's attributes there, `key` is an error since a person has none, and reads name their keys, as `feature('checkout')`.

## Grouping, ordering and the matrix

- **GROUP BY** gathers rows by one or more columns, and `count()` counts each group. SELECT names only what GROUP BY names, and `count()`. A list counts once per item, so totals can pass the rows. A read groups by its answer: On, Off and each share. With several environments, `environment` becomes a group of its own. Groups sort by count, most first, unless ORDER BY says otherwise, and `SELECT count()` alone counts every row WHERE keeps.
- **ORDER BY** takes properties, reads, details, `count()` in a grouped report, or a heading `AS` gave, quoted. Each sorts as it reads best: a flag by its share, `deadlineStatus` by urgency, `status` by how far it reached, `kind` as feature, variable, segment, attribute, numbers and dates by size, text naturally so `item-2` comes before `item-10`, a list by its first item. Blanks come last either way. A column need not be selected, except in a grouped report.
- **AS MATRIX** puts environments across the top, a column for each under every read. A read with an environment of its own, as `rollout(feature(key, 'production')) AS 'Live'`, stays one column. A matrix needs a read and cannot group. **AS MATRIX BY PERSON** puts each person across the top instead, a column per person under every read, and needs FROM.
- **LIMIT** comes after ordering, and the summary says how many there were, as "10 of 42 rows".

## Properties

| Property          | Type          | Rows                          | Holds                                                         |
| ----------------- | ------------- | ----------------------------- | ------------------------------------------------------------- |
| `key`             | text          | all                           | Its key                                                       |
| `kind`            | text          | all                           | feature, variable, segment or attribute                       |
| `description`     | text          | all                           | Its description                                               |
| `tags`            | list          | all                           | Its tags                                                      |
| `owner`           | text          | all                           | Its first owner, from metadata                                |
| `owners`          | list          | all                           | Its owners                                                    |
| `archived`        | true or false | all                           | Whether it is archived                                        |
| `deprecated`      | true or false | all                           | Whether it is deprecated                                      |
| `status`          | text          | features                      | production, enabled, other or disabled, as lists show         |
| `environments`    | list          | features, variables           | Environments it has rules or overrides in                     |
| `bucketBy`        | text          | features                      | What its rollouts bucket by, such as `userId and deviceId`    |
| `variations`      | list          | features                      | Its variations                                                |
| `variables`       | list          | features                      | Its own variables                                             |
| `type`            | text          | variables, attributes         | Its type                                                      |
| `format`          | text          | attributes                    | Its string format, such as `date-time`                        |
| `composed`        | true or false | variables                     | Whether it is composed of others                              |
| `segments`        | list          | features, variables, segments | Segments it uses directly                                     |
| `attributes`      | list          | features, variables, segments | Attributes it compares, and buckets by                        |
| `requires`        | list          | features, variables, segments | Features its conditions read                                  |
| `usedBy`          | number        | all                           | How many features and variables depend on it, directly or not |
| `usesDeprecated`  | true or false | features, variables, segments | Whether it depends on a deprecated feature                    |
| `differs`         | true or false | features                      | Whether its rules differ between environments                 |
| `promotable`      | true or false | features                      | Whether it can be promoted between environments               |
| `targets`         | list          | all                           | Targets it is in                                              |
| `tested`          | true or false | features, variables, segments | Whether tests cover it                                        |
| `testsPass`       | true or false | features, variables, segments | Whether its tests passed in the last supplied report          |
| `deadline`        | date          | all                           | When its most pressing open deadline is due                   |
| `deadlineType`    | text          | all                           | What that deadline is for, such as `remove`                   |
| `deadlineStatus`  | text          | all                           | overdue, today, upcoming, later or done                       |
| `updated`         | date          | all                           | When it last changed, from Git                                |
| `updatedBy`       | text          | all                           | Who last changed it                                           |
| `metadata.<path>` | text          | all                           | Anything else in its metadata, such as `metadata.jira`        |

In a report without FROM, a bare name is the person's attribute instead. `environment` names the environment when a report evaluates.

## Values

Write values as conditions write them: text in single quotes (`'nl'`, with `\'` inside), numbers (`42`, `-5`, `2.5`), `true`, `false`, `null`, lists (`['nl', 'de']`) and objects (`{ account: { seats: 60 } }`, keys bare or quoted). Double quotes are an error. In a VARY list, `OTHER` stands for everyone the conditions do not name.

## Recipes

Each is plain FQL, so adapt the names to the project. Results depend on the project, so read them from the page rather than predicting them.

**Rollouts in progress, furthest first**

```fql
FROM features
WHERE rollout(feature(key)) > 0 and rollout(feature(key)) < 100
ENVIRONMENT production
SELECT key, owner, rollout(feature(key)) AS 'Rollout'
ORDER BY 'Rollout' DESC
```

**Ready to ship: fully on in staging, not yet in production**

```fql
FROM features
WHERE rollout(feature(key, 'staging')) == 100
  and rollout(feature(key, 'production')) < 100
SELECT key, owner, feature(key, 'staging') AS 'Staging', feature(key, 'production') AS 'Production'
```

**Environments side by side, where rules differ**

```fql
FROM features
WHERE differs == true
ENVIRONMENT *
SELECT feature(key)
AS MATRIX
```

**Who gets a feature, by every audience its rules name**

```fql
FROM features
WHERE key == 'checkout'
VARY *
ENVIRONMENT *
SELECT feature(key)
AS MATRIX
```

**Cleanup candidates: fully on everywhere, with no variations**

```fql
FROM features
WHERE variations empty and rollout(feature(key, 'production')) == 100
SELECT key, owner, updated, deadlineType, deadline
ORDER BY updated
```

**Deprecated, still on for someone**

```fql
FROM features
WHERE deprecated == true and rollout(feature(key)) > 0
SELECT key, owner, feature(key), usedBy
```

**Gaps: no owner, no description or no tests**

```fql
FROM features, variables
WHERE owner notExists or description notExists or tested == false
SELECT kind, key, owner, description, tested
```

**Deadlines coming up, overdue first**

```fql
FROM features, variables, segments
WHERE deadlineStatus in ['overdue', 'today', 'upcoming']
SELECT kind, key, owner, deadlineType, deadline, deadlineStatus
ORDER BY deadlineStatus, deadline
```

**Ownership and tags, counted**

```fql
FROM features, variables
SELECT owner, count()
GROUP BY owner
ORDER BY count() DESC
```

A list counts once per item, so `GROUP BY tags` counts a feature under each of its tags.

**Impact before changing a segment or attribute**

```fql
FROM features, variables, segments
WHERE segments includes 'netherlands' or attributes includes 'country'
SELECT kind, key, segments, attributes, requires, usedBy
```

These are direct uses. `npx featurevisor find-usage` and the list filter `uses:netherlands` follow them at any depth.

**What one person gets, with why**

```fql
FROM features
CONTEXT { userId: 'user-1', country: 'de', plan: 'pro' }
SELECT key, feature(key), feature(key).variation, rule(feature(key)), reason(feature(key))
```

**Several people at once, a row each**

```fql
VARY userId ['user-1', 'user-2', 'user-3']
CONTEXT { country: 'nl' }
SELECT userId, feature('checkout'), feature('pricing').variation, variable('supportEmail')
```

A report without FROM has a row per person and columns read from anywhere, which is how FQL joins features and variables: the person is what they share. There is no JOIN keyword.

**Several people side by side, every feature a row**

```fql
FROM features
VARY [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3', country: 'de' }]
SELECT feature(key)
AS MATRIX BY PERSON
```

**Each place in a rollout**

```fql
CONTEXT { country: 'de' }
AT 10, 25, 50, 90
SELECT at, feature('checkout'), feature('pricing').variation
```

**An experiment's split in every market**

```fql
FROM features
WHERE variations notEmpty
VARY country
SELECT feature(key).variation
AS MATRIX
```

**A variable's value per variation and audience, and the override behind it**

```fql
VARY country ['nl', 'de', OTHER], plan ['paid', OTHER]
SELECT country, plan, feature('buyButton').maxQuantity, override(feature('buyButton').maxQuantity)
```

**Global variables per market, and which override applied**

```fql
FROM variables
VARY country ['nl', 'de', OTHER]
ENVIRONMENT production
SELECT key, variable(key), override(variable(key))
```

**Checking a change before review**: run the same report with `feature(key, 'staging')` beside `feature(key, 'production')`, or on the branch's running Catalog beside the deployed one, and compare the two links.

## Reading results

| Cell                                | Means                                                      |
| ----------------------------------- | ---------------------------------------------------------- |
| On, Off                             | On or off for everyone in the row, or for its one person   |
| `25%`                               | On for that share of the row's audience                    |
| `control 50% · treatment 50%`       | How the audience splits, as shares of the whole row        |
| `control: Buy · treatment: Buy now` | A variable whose value differs by variation                |
| `… varies`                          | A value read at one place in a rollout it changes with     |
| None                                | On, with no variation                                      |
| `""`                                | Empty text, apart from no value at all                     |
| A dash                              | Nothing to show, such as a feature not in that environment |

Clicking any evaluated cell opens a **Why** panel: the lens, the reason, the matched rule or override, the share, a split, what the answer requires and what it varies with.

## Common errors

Each error points at its line and column, and most say what to write instead.

| Written                                           | What to do                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SELECT enabled`, `variation`, `value`            | Read it: `feature(key)`, `feature(key).variation`, `variable(key)`                                                                              |
| `SORT BY`, `FOR`, `at` in CONTEXT or VARY         | Write `ORDER BY`, `CONTEXT`, `AT`                                                                                                               |
| Double quotes                                     | Text uses single quotes, as in conditions                                                                                                       |
| `WHERE archived`                                  | A bare name alone names a segment. Compare it: `archived == true`                                                                               |
| `WHERE tag:web`                                   | A list's filter. Write the condition the error gives: `tags includes 'web'`                                                                     |
| `feature(key)` without FROM features              | Name a key, as `feature('checkout')`, or add `FROM features`                                                                                    |
| `rollout()` of a variation or variable            | `rollout()` takes a flag read, as `rollout(feature(key))`                                                                                       |
| `rule()` of a global variable                     | Global variables have overrides: `override(variable(key))`                                                                                      |
| A column beside `count()`                         | Add it to GROUP BY, or select `count()` alone                                                                                                   |
| `AS MATRIX` with GROUP BY, or with no read        | A matrix shows reads across environments or people, and cannot group                                                                            |
| `AS MATRIX BY PERSON` without FROM                | Add FROM for its rows                                                                                                                           |
| No feature called `x`, or `x` has no variable `y` | Check the key against the project. A feature's missing variable lists the ones it has, and a global variable read as a feature is named as such |
| Too many evaluations                              | Narrow it with WHERE, fewer VARY values, columns or environments                                                                                |

## Limits and gotchas

- A report runs up to 20,000 evaluations (rows × people × environments × reads). Past that it shows none and asks for a narrower one: add WHERE, fewer VARY values, fewer columns or environments.
- `WHERE feature(key)` is true only when fully on. Use `rollout()` for "on for anyone".
- VARY lists values found in conditions only with exact operators. Name range values yourself.
- `uses:` and `usedby:` list filters follow dependencies at any depth. FQL's `segments`, `attributes` and `requires` are direct.
- The datafiles the page evaluates come from the export, so a stale export answers for the stale project. A running `npx featurevisor catalog` re-exports on every saved change.
- In beta, so prefer the cheat sheet's syntax when this reference and the page disagree, and tell the user.
