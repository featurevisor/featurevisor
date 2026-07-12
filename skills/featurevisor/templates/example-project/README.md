# Example Featurevisor project

A small but realistic Featurevisor project demonstrating the shapes the skill writes most often. Copy this into a new directory, `npm install @featurevisor/cli`, and `npx featurevisor lint && npx featurevisor test` should pass.

## Layout

```
.
├── featurevisor.config.js       # tags + environments
├── attributes/
│   ├── userId.yml               # string id (signed-in)
│   ├── deviceId.yml             # string id (anonymous)
│   ├── country.yml              # string, enum-validated
│   └── plan.yml                 # string, enum-validated
├── segments/
│   ├── countries/
│   │   └── netherlands.yml      # namespaced
│   └── qa.yml                   # force-target QA
├── features/
│   └── checkout.yml             # flag + variations + variables + force
├── targets/
│   └── all.yml                  # builds one datafile from the `all` tag
└── tests/
    ├── features/
    │   └── checkout.spec.yml
    └── segments/
        └── netherlands.spec.yml
```

## What it demonstrates

- Two environments (`staging`, `production`) and two tags (`web`, `all`).
- Signed-in + anonymous bucketing via `bucketBy: {or: [userId, deviceId]}`.
- A namespaced segment (`countries/netherlands`).
- A QA `force:` block so a known segment always sees the feature regardless of rollout %.
- A `targets/all.yml` so `npx featurevisor build` produces a `featurevisor-all.json` datafile per environment.
- A/B test with two variations (`control`/`treatment`).
- Variables of multiple types (string, boolean, array of strings, object).
- A per-rule variable override (NL gets a different `paymentMethods` array).
- A per-variation variable override using **mutation syntax** (`"hero.subtitle"`).
- Tests covering: catch-all rule, country-specific rule, force, and a matrix expansion.
