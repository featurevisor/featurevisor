# Namespaces

Full docs: <https://featurevisor.com/docs/namespaces/>

Namespaces are purely **organizational**: putting a feature, segment, global variable, or related test inside a subdirectory turns the directory name into a key prefix. They have no runtime effect beyond changing the key.

The separator between directory name and file name is `namespaceCharacter` in `featurevisor.config.js`. **The default is `.` (dot).** Some projects configure `/` instead. **Adapt to the project and never assume.** Check `npx featurevisor config --json --pretty`, then confirm against real keys (`npx featurevisor list --segments --json`, `list --features --json`) before writing any namespaced reference. A key written with the wrong separator fails lint at best, or silently creates a new entity outside the namespace at worst.

## Layout (default `.` separator)

```
features/
├── checkout/
│   ├── promo.yml          # key:  checkout.promo
│   ├── express.yml        # key:  checkout.express
│   └── oneClick.yml       # key:  checkout.oneClick
└── pricing.yml            # key:  pricing

segments/
├── countries/
│   ├── germany.yml        # key:  countries.germany
│   └── netherlands.yml    # key:  countries.netherlands
└── qa.yml                 # key:  qa
```

Nested directories are allowed and stack: `features/checkout/v2/promo.yml` has the key `checkout.v2.promo`.

Attributes are the exception. Keep their files directly in the configured attributes directory, also within Sets. `attributes/geo/country.yml` and dotted names such as `attributes/geo.country.yml` are rejected regardless of the namespace separator. The configured file extension is allowed. For nested context, declare an object in `attributes/geo.yml` and use `attribute: geo.country`. This dot is an object property path, not a namespace. See [attributes.md](attributes.md).

With `namespaceCharacter: "/"` configured, the same files produce `checkout/promo`, `countries/netherlands`, etc.

## Referencing namespaced keys

Wherever an entity key appears, use the full namespaced form:

```yaml
conditions:
  feature: checkout.oneClick

rules:
  - key: nl
    conditions: countries.netherlands
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

- A growing project where many teams contribute. Pair with a `CODEOWNERS` line such as `features/checkout/ @checkout-team`, which covers nested directories too, so the owning team reviews every change ([establishing ownership](https://featurevisor.com/docs/use-cases/establishing-ownership/)). CODEOWNERS patterns are file paths, so they always use `/` whatever `namespaceCharacter` is.
- Multi-product monorepos where a single Featurevisor project serves several apps. Namespace by product (`mobile/`, `web/`, `admin/` directories).
- Logical groupings even within a single product (`onboarding/`, `pricing/`, `experiments/`).

## What namespaces are **not**

- Not a substitute for [tags](tags.md): tags drive datafile bundling per consumer. Namespaces don't change which datafile a feature lands in.
- Not a substitute for [environments](configuration.md): namespaces don't gate rules per env.
- Not a security boundary: they're directories.

## Authoring tips

- Choose namespace names that describe **what** the features are about, not **who** owns them today (ownership rotates, but intent doesn't).
- Stay shallow. One or two levels handles most projects. Deep nests make keys unwieldy in SDK calls.
- Keep test spec paths mirroring source paths (`tests/features/checkout/promo.spec.yml` for `features/checkout/promo.yml`). This is a convention, not enforced.
- Once a feature is referenced by key in application code or other features, **don't rename the namespace or change `namespaceCharacter`**: either one rewrites every key inside it and breaks consumers.
