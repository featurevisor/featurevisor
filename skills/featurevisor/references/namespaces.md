# Namespaces

Full docs: <https://featurevisor.com/docs/namespaces>

Namespaces are purely **organizational**: putting a feature or segment inside a subdirectory under `features/` or `segments/` turns the directory name into a key prefix. They have no runtime effect beyond changing the key.

The separator between directory name and file name is `namespaceCharacter` in `featurevisor.config.js`. **The default is `.` (dot).** Some projects configure `/` instead — check the config (`npx featurevisor config --json --pretty`) and existing keys before referencing anything.

## Layout (default `.` separator)

```
features/
├── checkout/
│   ├── promo.yml          # key:  checkout.promo
│   ├── express.yml        # key:  checkout.express
│   └── oneClick.yml       # key:  checkout.oneClick
└── sidebar.yml            # key:  sidebar

segments/
├── countries/
│   ├── germany.yml        # key:  countries.germany
│   └── netherlands.yml    # key:  countries.netherlands
└── qa.yml                 # key:  qa
```

Nested directories are allowed and stack: `features/checkout/v2/promo.yml` → key `checkout.v2.promo`.

With `namespaceCharacter: "/"` configured, the same files produce `checkout/promo`, `countries/netherlands`, etc.

## Referencing namespaced keys

Wherever a feature or segment key appears, use the full namespaced form:

```yaml
# features/checkout/express.yml
required:
  - checkout.oneClick           # depend on another checkout feature

rules:
  production:
    - key: nl
      segments: countries.netherlands
      percentage: 100
```

In SDK calls:

```js
f.isEnabled('checkout.promo')
f.getVariation('checkout.promo')
```

In test specs:

```yaml
feature: checkout.promo
# ...
```

```yaml
segment: countries.netherlands
# ...
```

## When to use namespaces

- A growing project where many teams contribute. Pair with `CODEOWNERS` patterns like `features/checkout/* @checkout-team` for ownership (CODEOWNERS patterns are file paths, so they always use `/` regardless of `namespaceCharacter`).
- Multi-product monorepos where a single Featurevisor project serves several apps. Namespace by product (`mobile/`, `web/`, `admin/` directories).
- Logical groupings even within a single product (`onboarding/`, `pricing/`, `experiments/`).

## What namespaces are **not**

- Not a substitute for [tags](tags.md) — tags drive datafile bundling per consumer; namespaces don't change which datafile a feature lands in.
- Not a substitute for [environments](configuration.md) — namespaces don't gate rules per env.
- Not a security boundary — they're directories.

## Authoring tips

- Choose namespace names that describe **what** the features are about, not **who** owns them today (ownership rotates; intent doesn't).
- Stay shallow. One or two levels handles most projects; deep nests make keys unwieldy in SDK calls.
- Keep test spec paths mirroring source paths (`tests/features/checkout/promo.spec.yml` for `features/checkout/promo.yml`) — convention, not enforced.
- Once a feature is referenced by key in application code or other features, **don't rename the namespace or change `namespaceCharacter`** — either one rewrites every key inside it and breaks consumers.
