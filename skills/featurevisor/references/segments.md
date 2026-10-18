# Segments

Full docs: <https://featurevisor.com/docs/segments/>

A segment names an audience once, so features and variables can share it. Segments live in `segments/<key>.yml`, and a subdirectory adds a namespace to the key, such as `countries.netherlands` ([namespaces.md](namespaces.md)).

```yaml
description: Users in the Netherlands

conditions:
  - attribute: country
    operator: equals
    value: nl
```

Reference it by key wherever conditions appear. A bare string is always a segment:

```yaml
rules:
  - key: nl
    conditions: netherlands
    percentage: 100
```

## Conditions

Segments use the full [conditions grammar](conditions.md): attribute, segment, feature and variable leaves, combined with lists (AND), `and`, `or` and `not`.

```yaml
description: Adult iPhone users in the Netherlands or Germany, not on the newsletter

conditions:
  - attribute: device
    operator: equals
    value: iPhone
  - attribute: age
    operator: greaterThanOrEquals
    value: 18
  - or:
      - attribute: country
        operator: equals
        value: nl
      - attribute: country
        operator: equals
        value: de
  - not:
      - attribute: subscribedToNewsletter
        operator: equals
        value: true
```

`not` negates the AND of its children. `not: [a, b]` means "not both". For "none of these", wrap them in `or`:

```yaml
conditions:
  not:
    - or:
        - attribute: country
          operator: equals
          value: us
        - attribute: country
          operator: equals
          value: ca
```

A segment can reference another segment, a feature or a variable:

```yaml
description: Paying accounts with live chat

conditions:
  - payingAccounts
  - feature: liveChat
```

Lint rejects cycles, including mixed ones through features and variables. Operators and their type rules: [operators.md](operators.md).

## Authoring tips

- **Reuse first.** Run `npx featurevisor list --segments --json` and `npx featurevisor find-duplicate-segments` before creating one.
- **Name by intent.** `payingAccounts` outlives `planEqualsPro`.
- **Keep segments small and combine them in rules.** `conditions: { and: [iphoneUsers, netherlands] }` keeps each segment reusable.
- Attributes referenced in a segment must be declared in `attributes/`, and values must fit their types and constraints.

## Testing a segment

```yaml
segment: netherlands

assertions:
  - key: nl
    description: The Netherlands matches
    context:
      country: nl
    expectedToMatch: true

  - key: elsewhere
    matrix:
      country: [de, us]
    description: ${{ country }} does not match
    context:
      country: ${{ country }}
    expectedToMatch: false
```

A segment that depends on a feature or variable can fix those inputs with `at`, `stickyFeatures` and `stickyVariables`. Add `environment` when the project configures environments. See [testing.md](testing.md#segment-specs).

## Before renaming, archiving or deleting

```bash
npx featurevisor find-usage --segment=netherlands
```

This lists features and global variables that use the segment. An archived segment is left out of every datafile, so a rule or override using it would never match, and `not` around it would match everyone. Lint therefore rejects a reference to an archived segment from any definition or spec that is not archived itself, with `archived_reference`. Remove every reference in the same change, or archive the definitions that use it too, and delete the segment's specs. Lint checks an archived segment for its shape only, without resolving what its conditions name. Keep the archived file rather than deleting it, so the key is not reused with another meaning.

```yaml
description: Users in the Netherlands

archived: true

conditions:
  - attribute: country
    operator: equals
    value: nl
```

`npx featurevisor list --segments --archived=true` lists archived segments. `npx featurevisor find-usage --unused-segments` finds active segments nothing active references. Archived ones are left out, and `find-usage` marks archived users with `(archived)`.
