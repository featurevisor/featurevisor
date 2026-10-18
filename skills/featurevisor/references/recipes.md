# Recipes

Patterns for what people most often build with Featurevisor. Each section stands alone: read the one that matches the request, then adapt it to the project's attribute names, segments and environments.

Source guides: [Progressive delivery](https://featurevisor.com/docs/use-cases/progressive-delivery/), [Experiments](https://featurevisor.com/docs/use-cases/experiments/), [Remote configuration](https://featurevisor.com/docs/use-cases/remote-configuration/), [Entitlements](https://featurevisor.com/docs/use-cases/entitlements/), [Dependencies](https://featurevisor.com/docs/use-cases/dependencies/) and [Scheduled releases](https://featurevisor.com/docs/use-cases/scheduled-releases/).

Recipes use the default scaffold: direct lists for `rules`, `force` and `overrides`, and no `environment` in tests. With environments configured, put each list under its environment key.

| Recipe                                                                      | When                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| [Gradual rollout](#gradual-rollout)                                         | a flag ramped from 1% to 100%                        |
| [A/B test](#ab-test)                                                        | control against one treatment                        |
| [Multivariate test](#multivariate-test)                                     | several variations changing variables                |
| [Mutually exclusive experiments](#mutually-exclusive-experiments)           | experiments that must not overlap                    |
| [Feature dependencies](#feature-dependencies)                               | one feature requires another                         |
| [Remote configuration](#remote-configuration)                               | typed values changed without a release               |
| [One read for a screen](#one-read-for-a-screen)                             | an object assembled from several flags and values    |
| [Rename a global variable](#rename-a-global-variable)                       | change a key without breaking consumers              |
| [Kill switch](#kill-switch)                                                 | switch something off during an incident              |
| [Testing in production](#testing-in-production)                             | QA sees a feature real users do not                  |
| [Staged rollout](#staged-rollout)                                           | employees, then beta users, then everyone            |
| [Scheduled releases and time windows](#scheduled-releases-and-time-windows) | launch at a time, or for a period                    |
| [App version gate](#app-version-gate)                                       | only builds that contain the code                    |
| [Entitlements](#entitlements)                                               | capabilities per plan, with grants                   |
| [Role based access](#role-based-access)                                     | features for some roles                              |
| [Backend migration](#backend-migration)                                     | ramp traffic from an old implementation to a new one |
| [Deprecating a feature](#deprecating-a-feature)                             | wind a flag down safely                              |
| [Cleaning up stale flags](#cleaning-up-stale-flags)                         | retire flags that finished their job                 |
| [Trunk based development](#trunk-based-development)                         | merge unfinished work behind 0% flags                |
| [Microfrontends](#microfrontends)                                           | one datafile per frontend                            |
| [Establishing ownership](#establishing-ownership)                           | require the right reviewers                          |

---

## Gradual rollout

```yaml
description: Wishlist on product pages

bucketBy: userId

rules:
  - key: everyone
    conditions: '*'
    percentage: 1
```

- Raise `percentage` over time and keep the key. Users already in stay in.
- Lowering it takes users out, so warn before doing so.
- To target an audience first, add a rule **above** the catch-all rather than changing it:

```yaml
rules:
  - key: nl
    conditions: netherlands
    percentage: 100

  - key: everyone
    conditions: '*'
    percentage: 1
```

---

## A/B test

```yaml
description: Hero copy experiment

bucketBy: userId

variations:
  - value: control
    weight: 50
  - value: treatment
    weight: 50

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

```js
const context = {
  userId: '8f2a',
}

const variation = f.getVariation('heroCopy', context)

if (variation === 'treatment') {
  renderNewHero()
} else {
  renderHero()
}
```

Record exposure with a [tracking module](tracking.md). Do not rename variation values after launch, because analytics joins on them. Test each variation with `at` inside its weight range: `at: 25` for control, `at: 75` for treatment.

---

## Multivariate test

Variables let one experiment change several things without a code branch per combination:

```yaml
description: Hero multivariate test

bucketBy: deviceId

variablesSchema:
  headline:
    type: string
    defaultValue: Welcome to our site
  ctaText:
    type: string
    defaultValue: Learn more

variations:
  - value: control
    weight: 25
  - value: newCta
    weight: 25
    variables:
      ctaText: Get started
  - value: newHeadline
    weight: 25
    variables:
      headline: Hello there
  - value: both
    weight: 25
    variables:
      headline: Hello there
      ctaText: Get started

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

The application reads `f.getVariable('hero', 'headline', context)` and `f.getVariable('hero', 'ctaText', context)` without branching on the variation.

---

## Mutually exclusive experiments

A shared allocation feature at 100% divides users into cohorts, and each experiment requires its cohort in root `conditions`:

```yaml
conditions:
  - feature: experimentAllocation
    variation: first
```

Complete definitions, priority exclusion and tests: [mutual-exclusion.md](mutual-exclusion.md).

---

## Feature dependencies

```yaml
description: Express shipping, only with one click checkout

bucketBy: userId

conditions:
  - feature: oneClickCheckout

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

`expressShipping` is disabled whenever `oneClickCheckout` is, with reason `conditions_unmet`. Require a variation with `variation: treatment`, or require a feature to be off with `enabled: false`. Lint rejects cycles. Keep prerequisites exposed. See [conditions.md](conditions.md).

---

## Remote configuration

When a value belongs to no single feature, such as a support address or a retry limit, make it a [global variable](global-variables.md):

```yaml
description: Maximum items in the cart

type: integer

defaultValue: 50

overrides:
  - key: paying
    conditions: payingAccounts
    value: 200
```

When the value belongs to a feature, follows its variations, or needs a percentage rollout, use feature variables:

```yaml
description: Checkout configuration

bucketBy: userId

variablesSchema:
  paymentMethods:
    type: array
    defaultValue: [card, paypal]
    useDefaultWhenDisabled: true
  allowDiscountCode:
    type: boolean
    defaultValue: false
    useDefaultWhenDisabled: true

rules:
  - key: nl
    conditions: netherlands
    percentage: 100
    variables:
      paymentMethods: [ideal, paypal]
      allowDiscountCode: true

  - key: everyone
    conditions: '*'
    percentage: 100
```

`useDefaultWhenDisabled` keeps consumers from getting `null` if the feature is ever disabled.

---

## One read for a screen

A screen that reads a flag, a variation and several values can read one composed object instead:

```yaml
description: Everything the checkout page reads

compose:
  enabled: { feature: checkout }
  pricing: { feature: pricing, variation: true }
  label: { feature: buyButton, variable: label }
  support: { variable: supportEmail }
```

```js
const view = f.getVariableObject('checkoutView', context)
// { enabled: true, pricing: 'control', label: 'Buy', support: 'support@example.com' }
```

Every member is evaluated on each read, so reading it exposes the user to every experiment it references. Compose only values the screen always uses. Requires v4 SDKs in every consumer. Details: [global-variables.md](global-variables.md#compose-values).

---

## Rename a global variable

Move the definition to the new key and leave an alias at the old one:

```yaml
# variables/supportEmail.yml, the old key
description: Previous key, use contactEmail

compose: contactEmail

deprecated: true
```

Applications reading `supportEmail` keep working and log deprecation diagnostics. Update them to `contactEmail`, then archive the alias once `npx featurevisor find-usage --variable=supportEmail` and a search of application code find nothing.

Features cannot be renamed this way. A feature rename changes every bucket key and is a new feature for analytics. Create the new feature, migrate callers, then deprecate the old one.

---

## Kill switch

Two shapes. A **flag** around a risky path, normally at 100%:

```yaml
description: Route payments through Provider X. Set the percentage to 0 to fall back.

bucketBy: userId

rules:
  - key: everyone
    conditions: '*'
    percentage: 100
```

```js
if (f.isEnabled('paymentsProviderX', context)) {
  payWithProviderX()
} else {
  payWithFallback()
}
```

Or a **global variable** that switches off several features at once:

```yaml
# variables/maintenanceMode.yml
description: Set to true to switch off checkout and everything built on it

type: boolean

defaultValue: false
```

```yaml
# in each affected feature
conditions:
  - variable: maintenanceMode
    operator: equals
    value: false
```

Compare with `false` rather than wrapping `true` in `not`, so a missing value keeps the features on. Force entries still apply during maintenance, so QA keeps access. Test it in each feature's spec with `stickyVariables: { maintenanceMode: true }` and `expectedToBeEnabled: false`, or in one scenario that checks every affected feature ([testing.md](testing.md#scenarios)).

- Keep kill switches boring: no variations or variables.
- Lowering to 0 is fine here. The warnings about moving users protect experiments, and an infrastructure switch has no experience to preserve.
- Propagation takes merge, CI build and deploy, then each application's next datafile refresh. If seconds matter, applications must refresh often ([sdk-javascript.md](sdk-javascript.md#set-and-refresh-the-datafile)).
- State the emergency procedure in the `description`.

---

## Testing in production

QA exercises a feature that is at 0% for everyone else:

```yaml
# segments/qa.yml
description: QA team

conditions:
  or:
    - attribute: userId
      operator: in
      value: [u_qa_1, u_qa_2]
    - attribute: deviceId
      operator: in
      value: [dev_qa_1, dev_qa_2]
```

```yaml
force:
  - conditions: qa
    enabled: true
    variation: treatment

rules:
  - key: everyone
    conditions: '*'
    percentage: 0
```

Once QA signs off, raise the percentage. For one user, use an attribute leaf in the force `conditions` instead of a segment.

---

## Staged rollout

Employees, then opted-in beta users, then everyone. First match wins, so the order expresses the stages:

```yaml
rules:
  - key: employees
    conditions: employees
    percentage: 100

  - key: beta
    conditions: betaUsers
    percentage: 100

  - key: everyone
    conditions: '*'
    percentage: 0
```

```yaml
# segments/employees.yml
description: Employees, by email domain

conditions:
  - attribute: email
    operator: endsWith
    value: '@yourcompany.com'
```

Each stage has its own stable key, so ramping `everyone` never disturbs the earlier stages. `email` and `betaOptIn` must be declared attributes that the application passes.

---

## Scheduled releases and time windows

Featurevisor has no clock. The application passes the current time as an attribute. Use a trusted server clock for anything that matters, since browser clocks and context are under the user's control.

```yaml
# attributes/now.yml
description: Current time, supplied by the application

type: string

format: date-time
```

```yaml
# segments/blackFridayWeekend.yml
description: Black Friday weekend 2026

conditions:
  - attribute: now
    operator: after
    value: '2026-11-26T23:59:59.999Z'
  - attribute: now
    operator: before
    value: '2026-11-30T00:00:00Z'
```

Both operators are strict, so the start is one millisecond before launch to include the launch instant, and the end instant is excluded.

```yaml
rules:
  - key: black-friday
    conditions: blackFridayWeekend
    percentage: 100

  - key: everyone
    conditions: '*'
    percentage: 0
```

```js
const context = {
  userId: '8f2a',
  now: new Date(),
}

f.isEnabled('promoBanner', context)
```

- Pass a fresh time on every evaluation. An old `Date` does not advance.
- Missing or invalid dates make `before` and `after` false, and `not` can turn that into a match.
- Test just before, exactly at, and after each boundary with fixed timestamps in the spec context.
- Deploy the schedule ahead of time. Turning it off after launch means deploying a change, not restoring an older datafile.

---

## App version gate

Ship the code dark in a build, then enable it for builds that contain it:

```yaml
# attributes/appVersion.yml
description: Version of the mobile app

type: string

format: semver
```

```yaml
# segments/modernApp.yml
description: App 5.5 or newer

conditions:
  - attribute: appVersion
    operator: semverGreaterThanOrEquals
    value: '5.5.0'
```

```yaml
rules:
  - key: modern-app
    conditions: modernApp
    percentage: 100

  - key: everyone
    conditions: '*'
    percentage: 0
```

Quote versions. `5.10.0` is newer than `5.9.0`, and `5.5` equals `5.5.0`. Test with a matrix of versions on both sides of the boundary.

---

## Entitlements

Accumulate capabilities from a plan and individual grants in one global variable:

```yaml
# variables/entitlements.yml
description: Activities available to the current user

type: array

items:
  type: string

defaultValue: []

overrides:
  - key: premium
    conditions:
      attribute: plan
      operator: equals
      value: premium
    continue: true
    value: [likePosts, commentOnPosts, createPosts]

  - key: free
    conditions:
      attribute: plan
      operator: equals
      value: free
    continue: true
    value: [likePosts, commentOnPosts]

  - key: premium-us
    conditions:
      - attribute: plan
        operator: equals
        value: premium
      - attribute: country
        operator: equals
        value: us
    continue: true
    mutate:
      ':appendUnique': uploadVideos

  - key: posting-grant
    conditions:
      attribute: postingGrant
      operator: equals
      value: true
    mutate:
      ':appendUnique': createPosts
```

`continue: true` lets later matches add to the value. A free user with the grant gets `[likePosts, commentOnPosts, createPosts]`. `:appendUnique` prevents duplicates. Accumulation needs SDKs that support override programs ([compatibility](https://featurevisor.com/docs/sdks/compatibility/)).

```yaml
# tests/variables/entitlements.spec.yml
variable: entitlements

assertions:
  - key: free
    context: { plan: free }
    expectedValue: [likePosts, commentOnPosts]

  - key: premium-us
    context: { plan: premium, country: us }
    expectedValue: [likePosts, commentOnPosts, createPosts, uploadVideos]

  - key: free-with-grant
    context: { plan: free, postingGrant: true }
    expectedValue: [likePosts, commentOnPosts, createPosts]
    expectedEvaluation:
      variableOverrideKey: posting-grant

  - key: unknown-plan
    context: { plan: unknown }
    expectedValue: []
```

Evaluate entitlements on the server from trusted profile data. A browser evaluation controls presentation only and never authorizes anything.

---

## Role based access

Pass roles as an array attribute and list the roles that grant access:

```yaml
# attributes/roles.yml
description: Roles assigned by the trusted backend

type: array

items:
  type: string
  enum: [viewer, editor, admin]
```

```yaml
description: Bulk export for editors and admins

bucketBy: userId

rules:
  - key: contributors
    conditions:
      - attribute: roles
        operator: includesAny
        value: [editor, admin]
    percentage: 100

  - key: everyone
    conditions: '*'
    percentage: 0
```

List granting roles rather than negating a viewer role: a negated condition also matches visitors without roles. Test missing roles, an empty list, and users with several roles. Enforce protected operations on the server.

---

## Backend migration

Route reads from an old service to a new one behind a flag, evaluated per request with a [child instance](sdk-javascript.md#child-instances-server-side):

```yaml
description: Read orders from the new orders service

bucketBy: requestId

rules:
  - key: everyone
    conditions: '*'
    percentage: 1
```

```js
const child = f.spawn({ requestId: req.id })

const orders = child.isEnabled('ordersFromNewService')
  ? await newOrders.get(userId)
  : await legacyOrders.get(userId)

child.close()
```

Bucket by a request identifier when the migration is invisible to users, so ramping down is safe. Bucket by `userId` when users would notice flapping between implementations. At 100%, remove the old path, then [clean up](#cleaning-up-stale-flags).

---

## Deprecating a feature

1. Set `deprecated: true`. SDKs report `deprecated_feature` diagnostics when it is evaluated.
2. Agree a grace period with consuming teams.
3. Consumers remove their calls.
4. Confirm with `npx featurevisor find-usage --feature=<key>`, a search of application code, and the absence of deprecation diagnostics.
5. Set `archived: true`, delete its specs, then lint. Keep the archived file, so the key is never reused.

A feature variable is deprecated the same way, with `deprecated: true` in its `variablesSchema` entry.

---

## Cleaning up stale flags

Flags at 100% everywhere with no experiment are debt.

1. **Find candidates.** `npx featurevisor list --features --enabled --without-variations --json --pretty`, or `--enabled-in=production` with environments. Confirm the last rule is `conditions: '*'` at 100 everywhere, and check age in Git.
2. **Check dependents** with `npx featurevisor find-usage --feature=<key>`.
3. **Deprecate it**, so remaining callers surface.
4. **Remove the checks from application code**, including the dead branch. This is what pays the debt.
5. **Archive** the feature and delete its specs, then lint and test.

Offer this sweep when you see many long lived 100% flags.

---

## Trunk based development

1. Create the feature on the first day at 0%.
2. Each pull request adds a slice of code behind `f.isEnabled('<key>')`.
3. Force it on for a QA segment so the work can be exercised in production.
4. When ready, ramp the percentage.

---

## Microfrontends

One project, one target datafile per frontend, selected by tag:

```js
// featurevisor.config.js
module.exports = {
  tags: ['products', 'checkout', 'account'],
}
```

```yaml
# targets/checkout.yml
description: Checkout frontend

tag: checkout
```

```yaml
# a feature used by two frontends
tags:
  - products
  - checkout
```

Each frontend loads its own datafile, and features carrying both tags appear in both. For frontends serving anonymous and signed-in users, use `bucketBy: { or: [userId, deviceId] }`.

---

## Establishing ownership

Use `CODEOWNERS` to require reviews from the right teams:

```
# .github/CODEOWNERS
features/checkout/  @yourorg/checkout-team
segments/qa.yml     @yourorg/qa-team
attributes/         @yourorg/platform-team
```

With Sets as release lanes, a different team can own production:

```
sets/production/    @yourorg/release-owners
```

Pair it with branch protection that requires code owner review.
