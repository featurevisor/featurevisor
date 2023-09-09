---
title: Trunk-based Development
description: Learn how to achieve trunk-based development using Featurevisor
ogImage: /img/og/docs-use-cases-trunk-based-development.png
---

Trunk Based Development is a software development approach where all developers work in short-lived branches or directly in the trunk, which is the main codebase. {% .lead %}

The key principle is to integrate code changes frequently, ideally several times a day, to enable quicker detection and resolution of conflicts or bugs.

## What do we mean by trunk?

By "**trunk**", we mean the main branch of your repository.

If you are using Git, it is usually `main` or `master` branch.

## Benefits

- **Faster feedback loop**: Frequent merges mean quicker identification of code issues, allowing for immediate action.
- **Reduced merge conflicts**: Short-lived branches minimize the divergence from the trunk, reducing the likelihood of complicated merge conflicts.
- **Simplified debugging**: With smaller, more frequent merges, isolating the changes that introduced a bug becomes easier.
- **Accelerated release cycles**: The approach aligns well with Continuous Integration/Continuous Deployment (CI/CD) practices, facilitating quicker releases.
- **Improved collaboration**: Frequent integrations mean that developers are naturally more aligned with each other's changes, promoting a more collaborative environment.

## Potential disadvantages

- **Code instability**: Frequent merges can introduce instability into the main codebase if not adequately tested.
- **Overhead**: The need for frequent integrations and testing can be taxing on development and operations teams.
- **Learning curve**: Developers accustomed to long-lived branches may find it challenging to adapt to the quick pace and frequent merging resulting from adopting Trunk-Based Development.

## How Featurevisor helps

### Incremental changes

Featurevisor's feature management capabilities in the form of feature flags, a/b tests, and rollout rules enable you to merge code into the trunk even if it's not fully complete.

The feature can be hidden behind a flag until it's ready for production.

### Collaboration

Featurevisor adopts [GitOps workflow](/docs/concepts/gitops) for managing features.

This ensures that changes are reviewed and version-controlled, aligning perfectly with the principles of Trunk Based Development.

{% callout type="note" title="Separation of repositories" %}
It is very important to understand that a Featurevisor project with all its feature configurations is a separate repository from your main application codebase.

This enables you to manage and release your features independently of your application code deployments.
{% /callout %}

### Quick iterations

Featurevisor propagates feature flag changes instantly, allowing you to toggle features on or off without redeploying your application.

This way feature releases are decoupled from your actual application code deployments, enabling you to iterate quickly.

### A/B testing for feedback

Featurevisor’s built-in support for [A/B testing](/docs/use-cases/experiments) allows you to validate the impact of new features quickly, which aligns with quick feedback loops resulting from Trunk Based Development.

### Targeted releases

Using Featurevisor’s audience targeting capabilities, you can roll out features to [segmented audiences](/docs/segments), thus reducing the risk associated with frequent code merges into the trunk.

You can also see [Progressive Delivery](/docs/use-cases/progressive-delivery) for more details around gradual rollouts.

## Conclusion

Trunk Based Development offers a range of benefits, especially for organizations looking to accelerate their development cycles and improve collaboration.

Featurevisor complements this approach by providing the tools needed for safe, incremental changes, quick iterations, and effective feature management. While Trunk Based Development has its challenges, the robust capabilities of Featurevisor can significantly aid in mitigating the risks.
