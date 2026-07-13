# Recipes — common Featurevisor use cases

Patterns for the most common things users build with Featurevisor. Each section is self-contained — read just the one(s) relevant to the user's request.

Source docs (the authoritative versions): <https://featurevisor.com/docs/use-cases/>

| Recipe                                                                             | When                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Progressive delivery / gradual rollout](#progressive-delivery--gradual-rollout)   | Boolean flag, ramping 1% → 100% over days/weeks                 |
| [A/B test (two variations)](#ab-test-two-variations)                               | One control vs one treatment                                    |
| [Multivariate test (3+ variations + variables)](#multivariate-test-with-variables) | Headline + CTA combinations                                     |
| [Mutually exclusive experiments](#mutually-exclusive-experiments)                  | Two experiments running simultaneously, no user sees both       |
| [Feature dependencies](#feature-dependencies)                                      | Feature B should only evaluate if feature A is enabled          |
| [Remote configuration](#remote-configuration)                                      | Use Featurevisor as a typed config store, no rollout/experiment |
| [User entitlements / plans](#user-entitlements--plans)                             | Map plans → permissions, with per-user overrides                |
| [Testing in production / QA force](#testing-in-production--qa-force)               | QA team gets a feature production users don't                   |
| [Deprecating a feature safely](#deprecating-a-feature-safely)                      | Wind down a flag without breaking existing consumers            |
| [Trunk-based development](#trunk-based-development)                                | Merge incomplete code daily behind 0% flags                     |
| [Microfrontends](#microfrontends)                                                  | Single Featurevisor project, one datafile per microfrontend     |
| [Decouple release from deploy](#decouple-release-from-deploy)                      | Ship code anytime, expose features independently                |
| [Establishing ownership](#establishing-ownership)                                  | CODEOWNERS for feature/segment files                            |
| [Kill switch / operational flags](#kill-switch--operational-flags)                 | Instantly disable a risky surface or degraded dependency        |
| [Scheduled releases / time windows](#scheduled-releases--time-windows)             | Launch at a date/time, Black Friday campaigns, limited events   |
| [Staged rollout ladder](#staged-rollout-ladder)                                    | Employees → beta users → everyone                               |
| [App version gating](#app-version-gating)                                          | Only clients on version ≥ X get the feature (semver)            |
| [Backend migrations (strangler pattern)](#backend-migrations-strangler-pattern)    | Ramp traffic from an old implementation to a new one            |
| [Cleaning up stale flags](#cleaning-up-stale-flags)                                | Find and retire flags that finished their job                   |

Three further patterns live elsewhere: **RBAC / roles-and-permissions** is the [entitlements recipe](#user-entitlements--plans) with roles as variations (docs: <https://featurevisor.com/docs/use-cases/rbac>); **loading datafiles on demand** (start small, merge more target datafiles as the user navigates) is an SDK pattern — see [sdk-javascript.md](sdk-javascript.md#setting-and-updating-the-datafile); and **release lanes with promotion gates** (dev → staging → production as independent trees, QA-owned production) is the sets workflow — see [sets-promotions.md](sets-promotions.md#release-lane-workflow-canonical-shape).

---

## Progressive delivery / gradual rollout

A boolean flag rolled out gradually. The most common Featurevisor shape.

```yaml
# features/wishlist.yml
description: Wishlist for product detail pages
tags:
  - web
bucketBy: userId

rules:
  staging:
    - key: everyone
      segments: '*'
      percentage: 100

  production:
    - key: everyone
      segments: '*'
      percentage: 1                      # day 1: 1%
                                         # increase to 5, 10, 25, 50, 100 over days
                                         # NEVER rename the key
```

Guidance:

- Increase `percentage` only forward. Decreasing re-buckets.
- Keep the same `key` ("everyone") across all percentage changes.
- If you need to narrow targeting, **add a new rule above** the catch-all rather than mutating the catch-all:

```yaml
rules:
  production:
    - key: nl                            # target NL first at 100%
      segments: countries.netherlands
      percentage: 100
    - key: everyone                      # then ramp the rest
      segments: '*'
      percentage: 0
```

---

## A/B test (two variations)

```yaml
# features/heroCopy.yml
description: Hero copy A/B test
tags:
  - web
bucketBy: userId

variations:
  - value: control
    weight: 50
  - value: treatment
    weight: 50

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100                    # 100% are in the experiment;
                                         # split 50/50 by weight
```

In the application:

```js
const v = f.getVariation('heroCopy', { userId })
if (v === 'treatment') renderNew(); else renderOld()
```

Track activation with the [tracking module](tracking.md). Don't rename `control`/`treatment` after launch — your analytics dashboards key off these strings.

---

## Multivariate test with variables

Variables let one A/B test cover multiple UI knobs without code branching per combination.

```yaml
# features/hero.yml
description: Hero multivariate
tags:
  - web
bucketBy: deviceId

variablesSchema:
  headline:
    type: string
    defaultValue: Welcome to our site
  ctaButtonText:
    type: string
    defaultValue: Learn more

variations:
  - value: control
    weight: 25
  - value: treatment1
    weight: 25
    variables:
      ctaButtonText: Get started

  - value: treatment2
    weight: 25
    variables:
      headline: Hello there

  - value: treatment3
    weight: 25
    variables:
      headline: Hello there
      ctaButtonText: Get started

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

App reads `f.getVariable('hero', 'headline', ctx)` etc. — no need to branch on variation value.

---

## Mutually exclusive experiments

Two experiments must never overlap on the same user. Use a [group](groups.md).

```yaml
# groups/checkoutExperiments.yml
description: Mutually exclusive checkout experiments
slots:
  - feature: oneClickCheckout
    percentage: 50
  - feature: expressShipping
    percentage: 50
```

Then each member feature's percentage can go up to its slot cap (50% here):

```yaml
# features/oneClickCheckout.yml
rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 50                     # ≤ slot percentage
```

Plan slot sizes up front; resizing slots re-buckets everyone in the group.

---

## Feature dependencies

Feature B should only evaluate if feature A is enabled (and optionally a specific variation).

```yaml
# features/expressShipping.yml
description: Express shipping
tags:
  - checkout
bucketBy: userId

required:
  - oneClickCheckout                     # must be enabled

  # OR variation-specific:
  # - key: oneClickCheckout
  #   variation: treatment

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

Lint catches circular dependencies. A required and its dependent feature can't share a [group](groups.md).

---

## Remote configuration

Use Featurevisor purely as a typed, gradual-rollout-aware config store. The flag is essentially always-on; the value lives in variables.

```yaml
# features/checkoutConfig.yml
description: Checkout flow configuration (remote config, not an experiment)
tags:
  - checkout
bucketBy: userId

variablesSchema:
  paymentMethods:
    type: array
    defaultValue: [creditCard, paypal, applePay, googlePay]
  allowDiscountCode:
    type: boolean
    defaultValue: false

rules:
  production:
    - key: nl
      segments: countries.netherlands
      percentage: 100
      variables:
        paymentMethods: [paypal, ideal]
        allowDiscountCode: true
    - key: everyone
      segments: '*'
      percentage: 100                    # always on, just to expose variables
```

When the feature is conceptually always-on, set `useDefaultWhenDisabled: true` (or `disabledValue:`) per variable so consumers never get `null` even in edge cases.

---

## User entitlements / plans

Map plans → permissions. Use `variations` for plans, variables for the entitlement list. Combine with SDK sticky on the application side.

```yaml
# features/plan.yml
description: Plans and entitlements
tags:
  - all
bucketBy: userId

variablesSchema:
  entitlements:
    type: array
    defaultValue: [likePosts, commentOnPosts]

variations:
  - value: free
    weight: 100
  - value: premium
    weight: 0                            # not bucketed by weight;
    variables:                           # the *application* sets variation via sticky
      entitlements: [likePosts, commentOnPosts, createPosts]

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

App side (sketch, for context only):

```js
f.setSticky({
  plan: { enabled: true, variation: userProfile.plan }
})
const ents = f.getVariable('plan', 'entitlements', ctx)
```

For geo-restricted entitlements, use `variableOverrides` on the variation — see [variables-schemas.md](variables-schemas.md#from-a-variation).

**Always re-check entitlements server-side** — client checks are UX, not security.

---

## Testing in production / QA force

QA team can exercise a feature that's at 0% rollout for everyone else.

```yaml
# segments/qa.yml
description: QA team
conditions:
  or:
    - attribute: userId
      operator: in
      value: [u_qa_1, u_qa_2, u_qa_3]
    - attribute: deviceId
      operator: in
      value: [dev_qa_1, dev_qa_2]
```

```yaml
# features/wishlist.yml
# ...
force:
  production:
    - segments: qa
      enabled: true

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 0                      # off for real users
```

Once QA signs off, increase `percentage`. Leave the `force:` block to keep the segment usable across future features.

For force on a single user, use `conditions:` inline:

```yaml
force:
  production:
    - conditions:
        - attribute: userId
          operator: equals
          value: u_42
      enabled: true
      variation: treatment
      variables:
        bgColor: purple
```

---

## Deprecating a feature safely

```yaml
# features/oldThing.yml
deprecated: true                         # SDK logs warnings; still evaluable
# ...rest unchanged
```

Workflow:

1. Set `deprecated: true`.
2. Communicate the deprecation to consuming teams; agree on a grace window.
3. Consumers remove their calls to the feature.
4. Verify with `npx featurevisor find-usage --feature=oldThing` and by checking application logs for SDK warnings.
5. When confirmed unused: either `archived: true` (drops from datafiles) or delete the YAML.

A variable can be deprecated the same way:

```yaml
variablesSchema:
  bgColor:
    type: string
    defaultValue: red
    deprecated: true
```

---

## Trunk-based development

Merge incomplete code into `main` daily behind 0%-rolled-out flags. Featurevisor is the killer enabler:

1. Create the feature on day 1 with `percentage: 0` in production.
2. Each PR adds a small slice of code guarded by `f.isEnabled('myFeature')`.
3. Use `force:` for a QA segment so QA can exercise the in-progress feature without changing real-user rollout.
4. When ready, ramp the percentage.

Combines well with [Testing in production](#testing-in-production--qa-force) and [Progressive delivery](#progressive-delivery--gradual-rollout).

---

## Microfrontends

Single Featurevisor project; one Target datafile per microfrontend, usually selected by tags.

```js
// featurevisor.config.js
module.exports = {
  environments: ['staging', 'production'],
  tags: ['products', 'signup', 'signin', 'checkout', 'account'],
}
```

```yaml
# targets/products.yml
description: Products microfrontend
tag: products
```

```yaml
# targets/checkout.yml
description: Checkout microfrontend
tag: checkout
```

Each feature tags itself with the MF(s) it belongs to:

```yaml
tags:
  - products
  - checkout                             # used by both MFs → included in both bundles
```

For MFs that serve both anonymous and authenticated users:

```yaml
bucketBy:
  or:
    - userId                             # use userId if present (authenticated)
    - deviceId                           # else deviceId (anonymous)
```

This keeps logged-in users on the same variation across devices/sessions while still bucketing anonymous traffic.

---

## Decouple release from deploy

The thesis Featurevisor is built on. Pattern:

- App code is shipped routinely (multiple deploys/day if you want).
- Every new functionality is wrapped in a feature flag from day 1.
- Featurevisor (a separate Git repo) controls when each functionality is exposed to which users.
- Datafiles are deployed from the Featurevisor repo to a CDN; apps pick up changes via polling or push.

No special YAML — this is the workflow that emerges from using Featurevisor consistently. Don't ship code without a flag; don't expose a flag without a PR.

---

## Establishing ownership

Use GitHub `CODEOWNERS` to require specific teams to approve changes to specific files.

```
# .github/CODEOWNERS
features/checkout/* @yourorg/checkout-team
features/payments/* @yourorg/payments-team
segments/qa.yml     @yourorg/qa-team
attributes/*        @yourorg/platform-team
```

Use [sets](sets-promotions.md) if QA owns production rollout decisions:

```
sets/dev/features/payment/*        @yourorg/payments-team
sets/staging/features/payment/*    @yourorg/payments-team
sets/production/features/payment/* @yourorg/qa-team
```

Pair with branch protection ("Require review from Code Owners") to enforce.

---

## Kill switch / operational flags

Wrap risky surfaces — a third-party payment provider, a recommendation service, an expensive background job — in a flag that is normally on for everyone, so it can be turned off instantly during an incident without deploying anything.

```yaml
# features/paymentsProviderX.yml
description: 'KILL SWITCH — route payments through Provider X. Set percentage to 0 to fall back.'
tags:
  - all
bucketBy: userId

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100    # incident? change to 0, merge, done
```

App side falls back when disabled:

```js
if (f.isEnabled('paymentsProviderX')) { payWithProviderX() } else { payWithFallback() }
```

Guidance:

- **Keep kill switches boring**: no variations, no variables, one catch-all rule. Anything cleverer slows down the 3 a.m. responder.
- **Know your propagation time**: the change goes live after merge → CI datafile build/deploy → each app's next datafile refresh. If the user needs sub-minute reaction, make sure their apps refresh the datafile frequently ([sdk-javascript.md](sdk-javascript.md#keeping-the-datafile-fresh)).
- **Decreasing to 0 is fine here.** The re-bucketing warnings elsewhere in this skill protect *user-experience consistency* in experiments; a kill switch on an infrastructure path has no experience to preserve — turning it off for everyone is the whole point.
- Make the emergency procedure discoverable: state it in the feature's `description`.

---

## Scheduled releases / time windows

Featurevisor has no clock — **the application passes the current date into context**, and segments compare against it with the `before` / `after` operators. This powers launch moments, Black Friday campaigns, and limited-time events without anyone editing YAML at midnight.

```yaml
# attributes/date.yml
description: Current date, passed by the application as ISO 8601 string or Date object
type: date
```

```yaml
# segments/blackFridayWeekend.yml
description: Black Friday weekend 2026
conditions:
  and:
    - attribute: date
      operator: after
      value: 2026-11-27T00:00:00Z
    - attribute: date
      operator: before
      value: 2026-11-30T00:00:00Z
```

```yaml
# features/promoBanner.yml (rules excerpt)
rules:
  production:
    - key: bf
      segments: blackFridayWeekend
      percentage: 100
    - key: everyone
      segments: '*'
      percentage: 0
```

App side supplies the date on every evaluation (or in instance context refreshed periodically):

```js
f.isEnabled('promoBanner', { date: new Date() })
```

Guidance:

- The window boundaries are only as sharp as the app's evaluation cadence — long-lived SPAs should re-evaluate on navigation or on an interval, not once at startup.
- Merge and deploy the definitions **ahead of time**; the date condition does the launching. This is the calm way to ship a marketing moment.
- Combine freely with other targeting (`and` a country segment for regional campaigns).

---

## Staged rollout ladder

The classic product-engineering sequence: employees first, then opted-in beta users, then everyone. First-match-wins rule ordering expresses it directly.

```yaml
# segments/internalUsers.yml
description: Employees (by email domain)
conditions:
  - attribute: email
    operator: endsWith
    value: '@yourcompany.com'
```

```yaml
# segments/betaUsers.yml
description: Users who opted into the beta program
conditions:
  - attribute: betaOptIn
    operator: equals
    value: true
```

```yaml
# features/newEditor.yml (rules excerpt)
rules:
  production:
    - key: internal            # stage 1: employees, day one
      segments: internalUsers
      percentage: 100
    - key: beta                # stage 2: beta cohort
      segments: betaUsers
      percentage: 100
    - key: everyone            # stage 3: ramp the general public
      segments: '*'
      percentage: 0            # → 5 → 25 → 100 over time
```

Each stage is its own rule with its own stable key, so ramping `everyone` never disturbs employees or beta users. Attribute names (`email`, `betaOptIn`) must exist in `attributes/` and be supplied by the app in context.

---

## App version gating

Mobile (and desktop) clients run many versions at once. Gate features on the client version with semver operators so only builds that actually contain the code light up:

```yaml
# segments/appVersion55Plus.yml
description: App version 5.5.0 or newer
conditions:
  - attribute: appVersion
    operator: semverGreaterThanOrEquals
    value: 5.5.0
```

```yaml
# features/newOnboarding.yml (rules excerpt)
rules:
  production:
    - key: v55
      segments: appVersion55Plus
      percentage: 100
    - key: everyone
      segments: '*'
      percentage: 0
```

The pattern to internalize: **ship the code dark in version X, flip the flag when adoption of X is high enough**, and the flag+version gate together guarantee old builds never half-render a feature they don't contain.

---

## Backend migrations (strangler pattern)

Moving reads from an old service/datastore to a new one? Put the routing decision behind a flag and ramp it — with server-side [child instances](sdk-javascript.md#child-instances-server-side) giving per-request evaluation:

```yaml
# features/ordersFromNewService.yml
description: Route order reads to the new orders service
tags:
  - backend
bucketBy: requestId    # or userId if per-user consistency matters during migration

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 1     # 1 → 10 → 50 → 100 as confidence grows
```

```js
const childF = f.spawn({ requestId: req.id })
const orders = childF.isEnabled('ordersFromNewService')
  ? await newOrdersService.get(userId)
  : await legacyOrders.get(userId)
```

Guidance:

- Bucket by a **request-scoped attribute** when the migration is stateless — then ramping down after a bad deploy is completely safe (no user-visible consistency to break).
- Bucket by `userId` instead if the new path has user-visible differences that shouldn't flap between requests.
- When the migration completes at 100%, follow [Cleaning up stale flags](#cleaning-up-stale-flags) — delete the legacy branch from code, then the flag.

---

## Cleaning up stale flags

Flags that reached 100% everywhere and stopped mattering are debt: dead branches in code, noise in the project, misleading dashboards. Sweep periodically:

1. **Find candidates** — enabled everywhere, no experiment attached:
   ```bash
   npx featurevisor list --features --enabledIn=production --without-variations --json --pretty
   ```
   Cross-check age with Git history and confirm every environment sits at an unconditional 100%.
2. **Confirm nothing depends on them**: `npx featurevisor find-usage --feature=<key>` (other features' `required`, groups).
3. **Mark `deprecated: true`** — SDKs log warnings so consuming teams notice ([deprecation recipe](#deprecating-a-feature-safely)).
4. **Remove the flag checks from application code** — the `isEnabled` calls and the dead `else` branches. This is the step that pays the debt down.
5. **Archive or delete** the feature file once code no longer references it, then `npx featurevisor lint`.

Offer this sweep when you notice a project with many long-lived 100% flags — most teams want it, few remember to ask.
