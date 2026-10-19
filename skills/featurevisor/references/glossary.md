# Glossary

Full docs: <https://featurevisor.com/docs/glossary/>

Many "weird behaviour" reports come from mismatched vocabulary. Ground the user in these terms before going deep.

## Definitions

| Term                | Meaning                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Project**         | A Git repository with `featurevisor.config.js` and definition directories.                                                     |
| **Attribute**       | A declared, typed context key, such as `userId` or `country`. `attributes/<key>.yml`. Not in datafiles.                        |
| **Segment**         | A named audience defined by `conditions`. `segments/<key>.yml`.                                                                |
| **Feature**         | A flag, optional variations and feature variables, with rollout rules. `features/<key>.yml`.                                   |
| **Global variable** | A typed value with ordered overrides, not owned by a feature and never bucketed. `variables/<key>.yml`.                        |
| **Composition**     | A global variable built with `compose` from other evaluated values: an alias, or an object of flags, variations and variables. |
| **Schema**          | A reusable variable shape. `schemas/<key>.yml`.                                                                                |
| **Target**          | A datafile definition: which features and global variables it includes, and optional known context. `targets/<key>.yml`.       |
| **Tag**             | Metadata on features and global variables that targets select.                                                                 |
| **Namespace**       | A key prefix from a subdirectory, such as `checkout.promo`. Organization only.                                                 |
| **Spec**            | A `.spec.yml` file of assertions for a feature, segment or global variable.                                                    |
| **Scenario**        | A spec with root `checks` and no owner, checking several definitions together.                                                 |
| **Set**             | An independent definition tree under `sets/<set>/`, such as a release lane or a separate surface.                              |
| **Promotion**       | Copying definitions and their dependencies from one set to another with `promote`.                                             |

## Targeting and rollout

| Term                | Meaning                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Conditions**      | The one grammar for selecting and gating: attribute, segment, feature and variable leaves, with `and`, `or` and `not`. |
| **Root conditions** | Optional `conditions` at the top of a feature or global variable, gating all of it. Unmet: `conditions_unmet`.         |
| **Rule**            | A `conditions` and `percentage` entry in `rules`. The first match decides.                                             |
| **Rule key**        | A rule's stable identifier. Saved variation ranges are stored per key, so renaming reallocates them.                   |
| **Percentage**      | The share of matching users the rule enables, 0 to 100 with up to three decimals.                                      |
| **Force**           | Entries that set a result for matching contexts before root conditions and rules, typically for QA.                    |
| **Override**        | A conditional value: `variableOverrides` for feature variables, `overrides` for global variables.                      |
| **Mutation**        | A partial change to an object or array value through `mutate` or a dotted variable key.                                |
| **Expose**          | Controls whether a feature is included in datafiles. A temporary migration tool.                                       |
| **Deprecated**      | Still evaluated, with SDK warnings.                                                                                    |
| **Archived**        | Left out of every datafile.                                                                                            |

## Evaluation

| Term                  | Meaning                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context**           | The attribute values an application passes at evaluation time.                                                                                                                                                                                          |
| **Flag**              | A feature's enabled or disabled result.                                                                                                                                                                                                                 |
| **Variation**         | A feature's string result for experiments, such as `control` or `treatment`.                                                                                                                                                                            |
| **Feature variable**  | A typed value declared in a feature's `variablesSchema`.                                                                                                                                                                                                |
| **Bucketing**         | Hashing the `bucketBy` values and feature key to 0 to 100,000, the same in every SDK.                                                                                                                                                                   |
| **Sticky**            | Results the application supplies before the datafile is evaluated.                                                                                                                                                                                      |
| **Evaluation reason** | Why a result was returned: `sticky`, `forced`, `conditions_unmet`, `rule`, `allocated`, `no_match`, `disabled`, `feature_not_found`, `variable_override_rule`, `variable_composed`, `error` and others. Shown by `npx featurevisor evaluate --explain`. |
| **Exposure**          | A user seeing an experiment's variation, usually sent to analytics from a module.                                                                                                                                                                       |
| **Holdout**           | Users kept out of every experiment, so comparing them with everyone else shows the combined effect of the experiments.                                                                                                                                  |

## Datafiles

| Term            | Meaning                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Datafile**    | The static JSON an SDK loads, one per target and environment. v4 datafiles have `schemaVersion: "4"` and need v4 SDKs. |
| **Revision**    | A number each CI build increments and writes into datafiles.                                                           |
| **State files** | `.featurevisor/` files recording saved variation ranges between builds. Only CI commits them.                          |
| **Environment** | An optional stage name, such as `production`, keying rules within one definition.                                      |

## Patterns

| Term                                                                                   | Where                                                                                    |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Gradual rollout, kill switch, staged rollout, early access, scheduled release, cleanup | [recipes.md](recipes.md)                                                                 |
| A/B and multivariate tests                                                             | [features.md](features.md#variations), [recipes.md](recipes.md)                          |
| Mutually exclusive experiments                                                         | [mutual-exclusion.md](mutual-exclusion.md)                                               |
| Remote configuration                                                                   | [global-variables.md](global-variables.md), [variables-schemas.md](variables-schemas.md) |
| Entitlements                                                                           | [recipes.md](recipes.md#entitlements)                                                    |
