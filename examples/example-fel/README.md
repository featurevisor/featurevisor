# example-fel

A showcase of FEL, the Featurevisor Expression Language, for writing `conditions` as readable text. It sets `allowFEL: true` in `featurevisor.config.js`.

The project began as a copy of Example 1 with every condition written in FEL, and it is now its own project. On top of Example 1's definitions it adds a small workspace and shop: markets, audiences, devices and lifecycle segments, eleven features and four global variables. Every expression they hold has a spec.

This project is mostly used by the Featurevisor team for testing and development.

Visit [https://featurevisor.com](https://featurevisor.com) for more information.

## Where to look

### Comparing attributes

| What                                                      | Where                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `==` and `!=`, and how `!=` matches a missing value       | `segments/audiences/anonymous.yml`, `segments/devices/notDesktop.yml`                                               |
| Numbers, decimals and negative numbers                    | `segments/audiences/highValueCart.yml`, `segments/audiences/lowRisk.yml`, `segments/markets/farFromUtc.yml`         |
| Lists of strings, and lists of numbers                    | `segments/markets/benelux.yml`, `segments/audiences/smallTeams.yml`                                                 |
| `startsWith`, `endsWith` and `contains`                   | `segments/audiences/staff.yml`, `segments/audiences/partnerTraffic.yml`                                             |
| Regular expressions with flags                            | `segments/markets/francophone.yml`, `segments/audiences/couponHunters.yml`                                          |
| Dates with `before` and `after`                           | `segments/audiences/trial.yml`, `segments/audiences/dormant.yml`, `features/onboardingTour.yml`                     |
| Versions, prereleases and versions inside objects         | `segments/devices/modernIos.yml`, `segments/devices/prereleaseOs.yml`, `segments/devices/brokenBuilds.yml`          |
| Arrays with `includes`, `includesAny` and their negatives | `segments/audiences/workspaceAdmins.yml`, `features/adminConsole.yml`                                               |
| `exists`, `notExists`, `isNull`, `empty` and `notEmpty`   | `segments/audiences/incompleteProfile.yml`, `segments/lifecycle/localeNotChosen.yml`, `features/fraudScreening.yml` |
| Properties of object attributes                           | `segments/audiences/verifiedEnterprise.yml`                                                                         |
| Accents and escapes in strings                            | `segments/markets/swissCities.yml`, `segments/markets/italianCities.yml`                                            |

### Combining conditions

| What                                                                       | Where                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `and`, `or` and `not` with parentheses                                     | `segments/audiences/workspaceAdmins.yml`, `segments/audiences/priorityCustomers.yml` |
| Segments built from other segments, by namespaced name                     | `segments/markets/europe.yml`, `segments/audiences/priorityCustomers.yml`            |
| A named negative such as `notIn`, beside missing values handled explicitly | `segments/audiences/notOnFreePlan.yml`, `segments/audiences/freeOrUnknownPlan.yml`   |
| Comment lines inside block scalars                                         | `segments/audiences/staff.yml`, `features/smartCheckout.yml`                         |

### Reading features and variables

| What                                                      | Where                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Whether a feature is enabled, or disabled with `== false` | `features/smartCheckout.yml`, `features/upsellBanner.yml`                                 |
| A feature's variation                                     | `features/upsellBanner.yml`, `variables/checkoutCopy.yml`                                 |
| Feature variables, nested paths and an array's `length`   | `features/upsellBanner.yml`                                                               |
| Global variables with paths, indexes and bracketed keys   | `features/statusPage.yml`, `features/storefrontPromo.yml`, `variables/supportChannel.yml` |

### Every place conditions go

| Location                                        | Where                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Segment conditions                              | every file under `segments`                                                                  |
| A feature's root `conditions`                   | `features/smartCheckout.yml`, `features/adminConsole.yml`, `features/statusPage.yml`         |
| Force entries                                   | `features/smartCheckout.yml`                                                                 |
| Rules                                           | every feature                                                                                |
| Variable overrides in rules                     | `features/smartCheckout.yml`, `features/regionalPricing.yml`, `features/adminConsole.yml`    |
| Variable overrides in variations                | `features/smartCheckout.yml`                                                                 |
| A global variable's root `conditions`           | `variables/checkoutCopy.yml`                                                                 |
| Global variable overrides, nested ones included | `variables/checkoutCopy.yml`, `variables/platformStatus.yml`, `variables/supportChannel.yml` |

### YAML styles

`features/yamlStyles.yml` writes one kind of expression in each YAML style: a plain scalar, a double quoted scalar, a literal block with a comment line, a folded block, a list of expressions, expressions inside a tree `or` group, and a segment name beside a tree leaf.

Prettier turns single quoted YAML into double quotes, so expressions read best plain, double quoted or in a block. `"*"` stays quoted, since a bare `*` starts a YAML alias.

Some leaves stay as YAML objects beside FEL strings. A disabled feature's variation has no FEL form, as in `features/requiredFeaturesExample.yml`. `features/fraudScreening.yml` puts a tree leaf in the same group as expressions on purpose.

## Tests

- Every showcase segment, feature and global variable has a spec under `tests`, covering matches, near misses and missing values.
- `tests/scenarios/fel-shopper-journey.spec.yml` follows one shopper across segments, features and global variables, then changes one thing at a time.
- `tests/workflows/fel-markets.spec.yml` repeats market checks for five countries against the `fel-showcase` Target's datafile.

Run only the showcase segments with:

```sh
npx featurevisor test --entity-type=segment --key-pattern='^(markets|audiences|devices|lifecycle)\.'
```

Some segment specs pass `null` on purpose, to show `isNull` beside a missing value. Lint warns about them, since attributes do not declare `null`.

## Installation

```sh
npm install
```

## Usage

### Validate definitions

```sh
npm run lint
```

### Build datafiles

```sh
npm run build
```

### Run tests

```sh
npm test
```

### Browse the Catalog

Generates and serves the project catalog:

```sh
npm start
```

### Generate code

For additional type safety and autocompletion, you can generate TypeScript code from your definitions:

```sh
npm run generate-code
```

See output in `./src` directory.
