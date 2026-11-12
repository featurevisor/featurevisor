# Metadata

Full docs: <https://featurevisor.com/docs/metadata/>

`metadata` records what a team knows about a definition: who owns it, a ticket, when it should be reviewed or removed. It is for people. It never reaches a datafile, so adding, changing or removing it builds byte identical datafiles and the same revision, and never changes an evaluation or a test result.

Features, global variables, segments, attributes, targets and reusable schemas take it at the top level. Test specs do not, and neither does a schema nested inside another.

```yaml
description: Checkout redesign

metadata:
  owner: checkout-team
  jira: CHECKOUT-123

  deadlines:
    review:
      by: "2027-01-15T09:00:00Z"
      done: "2027-01-10T16:30:00Z"

    remove:
      by: "2027-03-01T09:00:00Z"
      description: Once every market is on the new checkout
      ticket: CHECKOUT-456

bucketBy: userId

rules:
  - key: everyone
    conditions: "*"
    percentage: 100
```

## What Featurevisor reads

Everything in `metadata` is free form JSON values, except two keys:

- `owner`: a name, or a list of different names. Catalog shows it and filters by it, and `list --owner` selects by it.
- `deadlines`: a map from a deadline type, such as `review`, to a deadline with `by`, optional `done` and optional `description`.

| Field         | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| `by`          | Required. An ISO 8601 timestamp with a timezone              |
| `done`        | `true`, or the timestamp it was done. `false` means not done |
| `description` | Text                                                         |

A type key starts with a letter and has only letters, digits, `_` and `-`. The statuses `overdue`, `today`, `upcoming`, `later`, `open` and `done` cannot be type names. Quote timestamps, as `fmt` writes them.

Timestamps are exactly what conditions' `before` and `after` accept, read by the same function: `YYYY-MM-DDTHH:mm:ss`, optional fractional seconds, then `Z` or `±HH:mm`. A date alone, such as `"2027-03-01"`, or a time without a timezone fails lint with `invalid_metadata`, since it names a different moment in every timezone. Suggest the date at a sensible hour in UTC, such as `"2027-03-01T09:00:00Z"`, and ask the user when the hour matters. A TOML date and time with an offset reads as its ISO text, and a TOML local date fails the same way.

## Statuses

Worked out when someone looks, never at build time:

- **done**: `done` is `true` or a timestamp.
- **overdue**: not done, from the moment in `by`, the same everywhere.
- **today** (later that day), **upcoming** (within 30 days), **later**. These count calendar days where the reader is: the browser's timezone in Catalog, the machine's in the CLI.

Nothing changes for users when a deadline passes. Lint warns about each open deadline that is overdue (`deadline_overdue`) or due today (`deadline_due_today`), and never fails because of a date unless asked. Done deadlines and archived definitions never warn. `lint --now=2027-03-02T12:00:00Z` checks deadlines as they stand at that moment, which also makes the warnings repeatable. `lint --fail-on=deadline_overdue` makes overdue deadlines errors that fail lint. Recommend it for a scheduled job or a release gate, not for pull requests, which would fail the day a date passes. Marking `remove` done does not archive anything, and `deprecated: true` does not mark a `deprecate` deadline done. Change the definition itself for that.

## The project's schema

`metadataSchema` in `featurevisor.config.js` validates metadata with the keywords and formats of reusable schemas, minus `schema`, so a moment is `format: date-time`. `format: date` is refused at load, as everywhere in Featurevisor. Its root is `type: 'object'`. Declared `properties` close an object, so an undeclared key fails lint, unless `additionalProperties: {}` allows any other key.

```js
module.exports = {
  metadataSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', enum: ['checkout-team', 'billing-team'] },
      jira: { type: 'string', pattern: '^[A-Z]+-[0-9]+$' },
      deadlines: {
        type: 'object',
        properties: {
          review: { description: 'Check the flag still earns its place' },
          remove: {
            description: 'Remove the flag and the code that reads it',
            properties: { ticket: { type: 'string' } },
            required: ['ticket'],
          },
        },
      },
    },
    required: ['owner'],
  },
}
```

- `properties.owner` narrows owners. With a list of owners, each must match.
- `properties.deadlines.properties` declares deadline types. Once declared, only those are allowed, unless `additionalProperties` gives a type for the rest. Its `required` lists types every definition with deadlines must have.
- A type may declare its own fields with `properties`, and `required` them, but never `by`, `done` or `description`. A deadline takes only the fields its type declares by name, so a type has no `additionalProperties`, and an undeclared field such as `ticket` fails lint until the type declares it.
- `required` at the root applies only to definitions that have metadata. `requireMetadataIn: ['features', 'variables']` requires metadata itself, archived definitions apart. One schema covers every kind. An empty `metadata: {}` fails lint, so leave the key out when there is nothing to record.

Read the project's `metadataSchema` before writing metadata, and use its owner names and deadline types.

## Lint codes

| Code               | Cause                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| `invalid_metadata` | Not an object, empty, a value with no JSON form, or a wrong `owner` or deadline |
| `metadata_schema`  | A value the project's `metadataSchema` refuses                                  |
| `missing_metadata` | A kind listed in `requireMetadataIn` has no metadata                            |

## Find it

```bash
npx featurevisor list --features --owner=checkout-team
npx featurevisor list --features --deadline=overdue --json
npx featurevisor list --features --deadline=remove --deadline=upcoming --now=2027-02-15T12:00:00Z
```

`--owner` repeated means every owner. `--deadline` takes a status or a type, in any case, and repeated values must all describe the same deadline. A near miss of a status, such as `overdu`, is refused with the status it is closest to. `--now` takes a timestamp and fixes the moment statuses use, for stable reports. JSON entries keep `metadata` as written and, with `--deadline`, add `deadlineStatuses`.

In Catalog, lists filter by `owner:`, `deadline:` and `metadata:key=value`, search finds owners and metadata values, and the home page and the Deadlines page show what is overdue and coming up. Archived definitions are left out of deadline statuses everywhere, unless a list search adds `archived:true`.

## Elsewhere

- `fmt` places `metadata` after `description` and `tags`, orders each deadline `by`, `done`, `description`, then its own fields, and leaves the rest of metadata as written.
- `diff` reports owners and deadlines by type. Promotions carry metadata with the definition. `convert` treats it as shared by every environment, so differing metadata between Sets blocks converting them to environments.
- Metadata is read as JSON writes it, so a TOML date reads as its text.
- Metadata is as public as the rest of a definition. Never put secrets or personal data in it.
