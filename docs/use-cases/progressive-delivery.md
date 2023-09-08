---
title: Progressive Delivery
description: Learn how to deliver features progressively to your users using Featurevisor.
ogImage: /img/og/docs-use-cases-progressive-delivery.png
---

Progressive Delivery is an advanced software release strategy that extends upon Continuous Delivery to involve techniques like feature flags, A/B testing, canary releases, and dark launches. {% .lead %}

It allows you to roll out new features gradually to a subset of your users rather than a big bang release to everyone. This enables safer deployments, better user experience, and a more controlled approach to releasing software.

## Benefits

- **Risk mitigation**: By rolling out features to a small group of users initially, you can detect issues early without impacting your entire user base.
- **User experience**: You can gather user feedback during the early stages of the release, making necessary adjustments before the full-scale rollout.
- **Performance monitoring**: Gives you room for monitoring of how new updates impact system performance and user behavior before you decide for wider rollout.
- **Rapid iteration**: Faster feedback loops allow for quick iterations, letting you adapt to user needs swiftly.
- **Compliance & security**: Easier to manage features in compliance with regulatory requirements (think of countries with strict data privacy laws like GDPR).

{% callout type="note" title="Featurevisor's building blocks" %}
It's important to learn the building blocks of Featurevisor to better understand rest of this guide:

- [Attributes](/docs/attributes): building block for conditions
- [Segments](/docs/segments): reusable conditions for targeting users
- [Features](/docs/features): feature flags and experiments with rollout rules
{% /callout %}

## Defining gradual rollouts

Featurevisor allows you to define your features' rollout [rules](/docs/features/#rules) declaratively including their targeting conditions, rollout percentage, and more.

A very simple feature flag can be defined as follows:

```yml
# features/myFeature.yml
description: My feature's description here
tags:
  - all

bucketBy: userId

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # everyone
        percentage: 10
```

In above example, we are rolling out the feature to only 10% of all our users in production environment.

We could have narrowed it down even further by using [segments](/docs/segments) to target only a specific group of users.

```yml
# features/myFeature.yml
description: My feature's description here
tags:
  - all

bucketBy: userId

environments:
  production:
    rules:
      - key: "1"
        segments:
          - germany
        percentage: 10
```

Here we are defining that the feature should be exposed to only 10% of users in Germany only, and not targeting 10% of all users worldwide like we did in previous example.

## Defining experiments

We could also achieve something similar using [A/B tests](/docs/use-cases/experiments), where we can define multiple variations of a feature and assign a percentage to each variation.

A/B testing would be more appropriate if we wish to measure two or more different variations of our feature, rather than a simple on/off toggle.

```yml
# features/myOtherFeature.yml
description: My other feature's description here
tags:
  - all

bucketBy: userId

variations:
  # default behaviour
  - value: control
    weight: 50

  # new behaviour to test
  - value: treatment
    weight: 25

  - value: anotherTreatment
    weight: 25

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # everyone
        percentage: 100
```

In above example, we are rolling out the feature to 100% of all our users in production environment, but 50% of them will see the default behaviour (`control`), and the other 50% will see two new different behaviour (`treatment` and `anotherTreatment`).

The weight distribution of the variations can be tweaked to your liking, and you can add as many variations as you want.

## Conclusion

Featurevisor provides the mechanism you need to implement a Progressive Delivery strategy effectively, both with simple feature flags and also with A/B tests.

Its blend of [feature management](/docs/feature-management), instant updates, and [GitOps workflow](/docs/concepts/gitops) makes it an approachable tool for engineering teams looking to improve their release processes, reduce risk, and accelerate time-to-market.
