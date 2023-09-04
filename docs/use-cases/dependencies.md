---
title: Managing Feature Dependencies
description: Learn how to manage feature dependencies using Featurevisor
ogImage: /img/og/docs-use-cases-dependencies.png
---

Imagine you're setting up a chain of dominoes. Each domino is set to fall only if the one before it does. In much the same way, Featurevisor introduces the concept of dependent feature flags, where one feature's availability can depend on another. {% .lead %}

This guide will walk you through how this powerful functionality can be a game-changer for any type of applications.

## When to use dependent feature flags?

- **Sequential rollouts**: When we want to roll out features in a specific order.
- **Feature combinations**: When one feature enhances or relies on another.
- **Complex A/B tests**: When we want to test multiple interrelated features together.
- **Conditional access**: When certain features should only be accessible under specific conditions.

## Example scenario

Let's say we have an e-commerce website and we want to introduce two new features:

1. **One-Click checkout**: Allows users to complete their purchase in a single click.
1. **Express shipping**: Offers faster delivery options for an extra fee.

## The dependency

For some business reason, we decide that the "**Express shipping**" feature should only be available if the "**One-Click checkout**" feature is enabled in the first place for the user.

In other words, "**Express shipping**" requires "**One-Click checkout**".

{% callout type="note" title="Learn the building blocks" %}
Before proceeding further, you are advised to learn the building blocks of Featurevisor to understand how features are defined declaratively:

- [Attributes](/docs/attributes)
- [Segments](/docs/segments)
- [Features](/docs/features)
{% /callout %}

## Defining our features

Assuming we have already set up our "**One-Click checkout**" feature as below:

```yml
# features/oneClickCheckout.yml
description: One click checkout

bucketBy: userId

tags:
  - checkout

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # Everyone
        percentage: 100
```

We can then require the `oneClickCheckout` feature when we defined our "**Express shipping**" feature:

```yml
# features/expressShipping.yml
description: Express shipping

bucketBy: userId

tags:
  - checkout

# define dependencies here
required:
  - oneClickCheckout

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # Everyone
        percentage: 100
```

With just two lines above, we declared our dependency between the two features without writing any complex code.

{% callout type="note" title="Learn more about requiring features" %}
Further guides on how to define dependencies between features:

- [Defining required features](/docs/features/#required)
{% /callout %}

## Using the SDK

When evaluating the `expressShipping` feature, Featurevisor SDK will automatically check if the `oneClickCheckout` feature is enabled for the user first internally.

If not, the `expressShipping` feature will be disabled.

```js
const featureKey = "expressShipping";
const context = { userId: "user-123" };

const isExpressShippingEnabled = sdk.isEnabled(featureKey, context);
```

## Adding a twist: A/B testing

Above example was very simple since we were only checking if features were enabled or not.

But what if we require a feature to be enabled only if a specific variation of another feature is enabled?

Let's say we want to test two variations in our `oneClickCheckout` feature:

```yml
# features/oneClickCheckout.yml
description: One click checkout

bucketBy: userId

tags:
  - checkout

# new variations introduced here
variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # Everyone
        percentage: 100
```

We have a 50-50 split between two variations `control` and `treatment`.

Now, we want to enable the `expressShipping` feature only if the `treatment` variation of `oneClickCheckout` is evaluated for the user.

{% callout type="note" title="Mutually exclusive experiments" %}
It's important to understand that we are not talking about mutually exclusive experiments here.

To learn about that, please refer to the following guides:

- [Groups](/docs/groups)
- [Experiments](/docs/use-cases/experiments)
{% /callout %}

We can express that as a requirement in our `expressShipping` feature:

```yml
# features/expressShipping.yml
description: Express shipping

bucketBy: userId

tags:
  - checkout

# define dependencies here
required:
  - key: oneClickCheckout
    variation: treatment

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # Everyone
        percentage: 100
```

Now whenever we evaluate the `expressShipping` feature, Featurevisor SDK will automatically check if the `oneClickCheckout` feature is enabled for the user and if the user has been bucketed into its `treatment` variation first.

{% callout type="note" title="Learn more about experimentation" %}
We have several guides helping you understand how experiments work in Featurevisor using A/B tests and multivariate tests:

- [Experiments](/docs/use-cases/experiments)
- [Defining variations](/docs/features/#variations)
- [Defining bucketing rule](/docs/features/#bucketing)
- [Bucketing concept](/docs/bucketing/)
{% /callout %}

## Benefits of using Featurevisor

- **Simplicity**: No need for complicated hardcoded logic to manage feature dependencies. Declare it once and you're done.
- **Flexibility**: Easily run complex A/B tests involving multiple dependent features.
- **Control**: Decide not just whether a feature is on or off, but also under what conditions it should be available.
- **Reduced risk**: By controlling feature dependencies, you can ensure that users experience features in a coherent and logical manner, reducing the risk of errors or confusion.
- **Collaboration**: Featurevisor's [GitOps](/docs/concepts/gitops) workflow makes it easy for cross-functional teams to collaborate on feature changes in one single place avoiding any issues arising from lack of awareness and visibility.

## Circular dependencies

Featurevisor's [linting](/docs/linting-yamls) step makes sure that you don't introduce any circular dependencies between your features.

This will happen if you try to require a feature that requires the current feature. In our case that would be `expressShipping` requiring `oneClickCheckout` which requires `expressShipping`.

Even if you try to do that, Featurevisor will throw an error and prevent you from building the [datafiles](/docs/building-datafiles) saving you from a lot of headache.

## Conclusion

Managing feature flags in any type of application becomes incredibly straightforward with Featurevisor. Its ability to handle dependent feature flags through a simple, declarative approach offers a powerful tool for businesses to roll out and test new features in a controlled, logical manner.

So next time you're setting up those dominoes, remember: Featurevisor ensures they fall exactly the way you want them to.
