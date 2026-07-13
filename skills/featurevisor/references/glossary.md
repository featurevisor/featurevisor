# Glossary — Featurevisor terms

Full docs: <https://featurevisor.com/docs/glossary>

Short reference of terms used throughout Featurevisor. When in doubt, ground the user in these before going deep — many "weird behaviour" reports come from mis-mapped vocabulary.

## Building blocks

| Term          | Meaning                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Project**   | A Git repository containing `featurevisor.config.js` + `attributes/`, `segments/`, `features/` (and optionally `groups/`, `schemas/`, `tests/`). |
| **Attribute** | A named, typed key the SDK receives at evaluation (e.g. `userId`, `country`). Defined in `attributes/<key>.yml`.                                 |
| **Segment**   | A reusable named condition over attributes. Defined in `segments/<key>.yml`. References attributes by name.                                      |
| **Feature**   | A flag/variation/variable bundle with rollout rules. Defined in `features/<key>.yml`. References segments by name.                               |
| **Group**     | Mutual-exclusion container that constrains percentage caps for member features. `groups/<name>.yml`.                                             |
| **Schema**    | Reusable variable shape, referenced by name from `variablesSchema` entries. `schemas/<name>.yml`.                                                |
| **Test spec** | Declarative `.spec.yml` asserting expected evaluation outcomes. `tests/features/...` or `tests/segments/...`.                                    |

## Evaluations

| Term                  | Meaning                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Flag**              | The boolean enabled/disabled outcome for a feature.                                                                                              |
| **Variation**         | The string outcome for a feature with `variations:` — e.g. `control`, `treatment`.                                                               |
| **Variable**          | A typed value (string/boolean/integer/double/array/object/json) attached to a feature.                                                           |
| **Context**           | The object of attribute values supplied at evaluation time.                                                                                      |
| **Bucketing**         | Deterministic hash of `(featureKey, bucketBy attribute values)` → number in [0,100].                                                             |
| **Sticky**            | SDK-side override for a feature (variation/variables/enabled) consulted before rules.                                                            |
| **Activation**        | The event of a user being assigned a variation; commonly piped to analytics.                                                                     |
| **Evaluation reason** | One of `sticky`, `disabled`, `required`, `forced`, `rule`, `allocated`, `out_of_range`, `no_match`, `feature_not_found`, `error`, etc. — surfaced by `featurevisor evaluate --verbose`. |

## Rollout terms

| Term           | Meaning                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Rule**       | A targeting + percentage entry under `rules.<env>[]`. First match wins.                                                           |
| **Rule key**   | Unique-per-env stable identifier on a rule. Renaming re-buckets users — don't.                                                    |
| **Percentage** | 0–100 (2 decimal places) — share of bucketed users in a rule that get the feature.                                                |
| **Force**      | Per-env override that bypasses rules for matching context — used for QA, specific users.                                          |
| **Required**   | Dependency declaration: this feature only evaluates if listed features evaluate as enabled (and optionally a specific variation). |
| **Expose**     | Per-env (and optionally per-tag) inclusion control for whether a feature ships in a datafile. Short-term migration tool.          |
| **Deprecated** | Feature/variable is on the way out; SDK logs a warning when used. Still works.                                                    |
| **Archived**   | Feature/segment/attribute excluded from datafiles entirely.                                                                       |

## Concepts around datafiles

| Term            | Meaning                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Datafile**    | Static JSON output the SDK loads. One per target and optional environment. Generated datafiles use schema version 2.   |
| **Tag**         | Feature metadata used by targets to select features.                                                                    |
| **Target**      | A generated datafile definition with optional tag filters, feature-key filters, and build-time context.                 |
| **Namespace**   | Directory-based prefix on feature/segment keys (`features/checkout/promo.yml` → `checkout.promo` with the default `.` separator). Organizational only. |
| **Revision**    | Integer incremented per successful build; stamped into every datafile.                                                  |
| **State files** | `.featurevisor/state-*.json` snapshots used to preserve bucketing across builds.                                        |

## Patterns / use cases

| Term                               | Where it shows up in this skill                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Feature flag / toggle**          | Boolean rollout — see [features.md](features.md) and recipes "progressive delivery".              |
| **A/B test**                       | Feature with two `variations`. See recipes "experiments".                                         |
| **Multivariate test**              | Feature with more than two `variations`, often with variable overrides.                           |
| **Canary release / dark launch**   | Force-enabled for a QA segment in production while flag is 0% to real users.                      |
| **Remote configuration**           | Feature whose primary outputs are `variables`, not the flag itself.                               |
| **Entitlements**                   | Variables holding lists of capabilities, often pinned via sticky from a profile service.          |
| **Mutually exclusive experiments** | Multiple features sharing a [group](groups.md) so no user sees both.                              |
| **Trunk-based development**        | Merging incomplete features behind a 0%-rolled-out flag.                                          |
| **Kill switch / ops flag**         | Always-on flag around a risky surface; flipped to 0% during incidents. See recipes.               |
| **Scheduled release**              | Segment with date `before`/`after` conditions; app passes current date in context. See recipes.   |
| **Staged rollout**                 | Ordered rules: employees → beta users → everyone. See recipes.                                    |
| **Decouple deploy from release**   | The whole point of the tool: ship code at any time, expose it via Featurevisor whenever you want. |

## Operators (quick recall)

See [operators.md](operators.md) for the full table. Equality, ordering, string ops (contains/startsWith/endsWith/in/matches), array ops (includes/notIncludes), semver, date (before/after), existence (exists/notExists).
