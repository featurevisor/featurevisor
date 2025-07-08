---
title: Deprecating feature flags safely
nextjs:
  metadata:
    title: Deprecating feature flags safely
    description: Learn how to deprecate features and experiments safely with Featurevisor
    openGraph:
      title: Deprecating feature flags safely
      description: Learn how to deprecate features and experiments safely with Featurevisor
      images:
        - url: /img/og/docs-use-cases-deprecation.png
---

Deprecating feature flags is an essential part of feature flag lifecycle management. As our application and organization grow, some features become permanent while others may be discarded. {% .lead %}

Proper management of these features and a/b test experiments prevents clutter, reduces technical debt, and maintains the efficiency and performance of our application's codebase.

## What is deprecation?

In software development, deprecation refers to the practice of marking certain features, functionalities, or elements in a codebase as obsolete, outdated, or no longer recommended for use.

This is often done when a feature or functionality is:

- replaced by a newer or more efficient version, or
- when it's decided that the feature is no longer necessary

## Deprecating feature flags

Similar to any regular functionalities in software, feature flags can also be deprecated.

When a feature flag is deprecated, it means that the feature flag is no longer needed and should be removed from the codebase.

## Grace period

When deprecating a feature flag, it's a good practice to provide a grace period for developers to remove the usage of that feature flag from the codebase.

This makes sure we are not unintentionally breaking the application for users who are still using the deprecated feature.

The grace period can be a few days, weeks, or months, depending on the complexity of the feature and the number of places it's used in the codebase. Ultimately it's an organization level decision.

## How does it work in Featurevisor?

Given Featurevisor allows us to manage both feature flags and [experiments](/docs/use-cases/experiments) as [features](/docs/features) declaratively, it makes it very convenient for us to mark some of them as [deprecated](/docs/features/#deprecating).

We can do that right from the same file where we define our feature:

```yml {% path="features/my_feature.yml" %}
description: My feature description...
tags:
  - web
  - ios
  - android

# we set `deprecated` to `true`
deprecated: true

# ...
```

Notice the usage of `deprecated: true` above. That's all we need to do to mark a feature as deprecated, and Featurevisor will take care of the rest.

{% callout type="note" title="Deprecating attributes and segments" %}
Unlike features, [attributes](/docs/attributes) and [segments](/docs/segments) cannot be deprecated.

Featurevisor's [datafile builder](/docs/building-datafiles) is smart enough to not include attributes and segments that are not used in your desired features. That's why we don't need to worry about deprecating them, and can archive or delete them directly if needed.
{% /callout %}

## Warnings in applications

When a feature is marked as deprecated, Featurevisor [SDKs](/docs/sdks/) will automatically show a warning in the applications that are evaluating the deprecated feature.

This lets developers know immediately that the feature is deprecated and should be removed from the codebase.

Optionally, we can take over the warning messages via the [logger API](/docs/sdks/javascript/#logging) of SDKs if we wish to customize the warning messages further or track them via our preferred logging and monitoring system.

## Deleting deprecated features

Once the development teams have removed the deprecated feature flags from the codebase, and no warnings are visible anywhere in the applications, we can safely [archive](/docs/features/#archiving) or delete the deprecated feature from Featurevisor.

## Conclusion

Creating new functionalities and having them managed via several feature flags and experiments is a common practice in modern software development. However, it's equally important to manage these features' lifecycle properly.

We do not wish to find ourselves in a situation where we only keep creating new features and never take the time to clean them up. This affects both the performance and maintainability of our applications.

With Featurevisor, we can embrace its highly declarative way of managing features and experiments effectively. Including deprecating them when they are no longer needed, providing a grace period for developers to remove them, and finally deleting them from the system safely.
