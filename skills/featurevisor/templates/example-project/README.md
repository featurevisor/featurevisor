# Example Featurevisor project

A small Featurevisor v4 project showing the shapes the skill writes most often. Copy this directory, run `npm install`, and `npx featurevisor lint` and `npx featurevisor test` both pass.

## Layout

```
.
├── featurevisor.config.js      # no environments, the default scaffold
├── attributes/
│   ├── userId.yml              # signed-in identity
│   ├── deviceId.yml            # anonymous identity
│   ├── country.yml             # string with a pattern
│   ├── plan.yml                # string with an enum
│   └── appVersion.yml          # string with format: semver
├── segments/
│   ├── countries/
│   │   └── netherlands.yml     # namespaced key: countries.netherlands
│   ├── modernApp.yml           # semver condition
│   └── qa.yml                  # or group, used by force
├── features/
│   ├── checkout.yml            # A/B test, variables, force, root gate on a variable
│   └── liveChat.yml            # rollout gated by app version
├── variables/
│   ├── supportEmail.yml        # global variable with an override
│   ├── maintenanceMode.yml     # kill switch read by checkout's conditions
│   ├── checkoutPromoBanner.yml # gated on the checkout feature
│   └── checkoutView.yml        # composition of a flag, variation and variables
├── targets/
│   └── all.yml                 # no selectors: every active definition
└── tests/
    ├── features/
    ├── segments/
    ├── variables/
    └── scenarios/
        └── maintenance.spec.yml
```

## What it shows

- Bucketing that falls back from `userId` to `deviceId` with `bucketBy: { or: [userId, deviceId] }`.
- Unified `conditions` with all four leaf kinds: attribute, segment (a bare string), feature and variable.
- A root gate on a global variable: setting `maintenanceMode` to `true` disables `checkout` with reason `conditions_unmet`. Force entries run before the gate, so QA keeps access.
- An A/B test whose treatment changes one property of an object variable through a mutation key.
- Rule variables and a keyed `variableOverrides` entry inside a rule.
- A version gate on a `format: semver` attribute, with quoted versions.
- A global variable gated on a feature, which returns its `disabledValue` when the feature is off.
- A `compose` map that reads a flag, a variation, a feature variable and a global variable in one call.
- Specs with stable assertion `key`s, a matrix, global variable `checks`, a feature assertion that switches the kill switch on with `stickyVariables`, and a standalone scenario that checks everything built on checkout at once.

## Try it

```bash
npx featurevisor lint
npx featurevisor test
npx featurevisor evaluate --feature=checkout --context='{"userId":"8f2a","country":"nl"}' --explain
npx featurevisor evaluate --variable=checkoutView --context='{"userId":"8f2a","country":"nl"}' --explain
npx featurevisor build --no-state-files
npx featurevisor catalog
```

With environments configured, nest each `rules`, `force` and global `overrides` list under its environment key, and add `environment` to tests.
