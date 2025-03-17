---
title: Namespaces
description: Organize your features and segments under namespaces in a hierarchical way.
ogImage: /img/og/docs-namespaces.png
---

Featurevisor allows namespacing features and segments to tackle the challenges of scaling large projects. {% .lead %}

Namespaces help teams organize their features and segments in a structured and hierarchical way, making it easier to manage and maintain them as their project grows larger and more complex over time.

## Features

Creating a namespace for a [feature](/docs/features/) is as simple as putting the feature under a directory, and the directory name then becomes the namespace.

If there is a team working on the checkout flow for e.g., they can create a namespace called `checkout` and put all their features related to the checkout flow in that namespace:

```
features/
├── checkout/
│   ├── feature1.yml
│   ├── feature2.yml
│   └── feature3.yml
└── globalFeature.yml
```

### Evaluating features

When evaluating a feature, you can refer to the feature by its namespace and key in the format `namespace/featureKey`:

```js
const f; // Featurevisor SDK instance
const context = { userId: "123" };

f.isEnabled("checkout/feature1", context);
f.isEnabled("globalFeature", context);
```

### Testing features

When [testing features](/docs/testing/#testing-features), you can refer to the feature by its namespace and key in the format `namespace/featureKey`:

```yml
# tests/checkout/feature1.spec.yml
feature: checkout/feature1

# ...
```

The file name and location for test specs do not matter, as long as they exist inside the `tests` directory.

## Segments

Very similar to features, you can namespace [segments](/docs/segments/) by putting them in a directory:

```
segments/
├── countries/
│   ├── germany.yml
│   └── netherlands.yml
└── globalSegment.yml
```

### Referencing segments

When defining the [rules inside features](/docs/features/#rules), you can refer to the segment by its namespace and key in the format `namespace/segmentKey`:

```yml
# features/myFeature.yml

# ...

environments:
  production:
    rules:
      - key: "1"
        segments: "countries/netherlands"
        percentage: 100
```

### Testing segments

When [testing segments](/docs/testing/#testing-segments), you can refer to the segment by its namespace and key in the format `namespace/segmentKey`:

```yml
# tests/countries/nl.spec.yml
segment: countries/nl

# ...
```

## Comparison

Namespaces are no replacement for [tags](/docs/tags/) or [environments](/docs/environments/), but they can be used in conjunction with them to create a more structured and organized project.

- **Tags**: for [tagging features](/docs/tags/) resulting in targeted and smaller [datafiles](/docs/building-datafiles/) that your applications consume via [SDKs](/docs/sdks/)
- **Environments**: for creating different [environments](/docs/environments/), like `production` and `staging`, and then use them in your feature [rules](/docs/features/#rules) to control the rollout of features
- **Namespaces**: for organizing features and segments in a hierarchical way
