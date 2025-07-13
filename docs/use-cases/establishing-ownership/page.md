---
title: Establishing feature ownership
nextjs:
  metadata:
    title: Establishing feature ownership
    description: Learn how to handle feature ownership with Featurevisor
    openGraph:
      title: Establishing feature ownership
      description: Learn how to handle feature ownership with Featurevisor
      images:
        - url: /img/og/docs-use-cases-establishing-ownership.png
---

With the adoption of Featurevisor, many development teams can face the challenge of managing individual feature ownership. Since all configuration is managed as files in a Git repository, it's essential to ensure that the right teams or individuals are notified and have the authority to approve changes to specific feature flags. {% .lead %}

Without proper management, unintended changes could be introduced, leading to potential issues in the production environment, misaligned business goals, or security vulnerabilities.

## Code owners

GitHub has a feature called [CODEOWNERS](https://docs.github.com/en/github/creating-cloning-and-archiving-repositories/about-code-owners) that allows you to define individuals or teams that are responsible for code in a repository. This feature can be used to ensure that the right people are notified and have the authority to approve changes to specific files in the repository.

You can also find similar functionality in other Git hosting providers, including:

- [GitLab](https://docs.gitlab.com/ee/user/project/codeowners/)
- [Bitbucket](https://support.atlassian.com/bitbucket-cloud/docs/use-code-owners-to-define-owners-for-files-and-directories/)

This guide assumes we are using GitHub.

## Benefits

- **Clear ownership**: By specifying who owns which file, there's clear accountability for each feature. This ensures that only the responsible teams or individuals can approve changes, making it easier to track decisions back to specific entities.
- **Automated review process**: GitHub automatically requests reviews from the appropriate code owners when a pull request changes any files they own. This streamlines the review process and ensures that no changes go unnoticed.
- **Enhanced security**: If any malicious or unintended changes are introduced to a feature flag, they can't be merged without the consent of the owner. This layer of security is especially crucial for critical features or those that might impact user data or system stability.
- **Reduced friction**: Teams don't need to manually tag or notify stakeholders when they make changes to feature flags. GitHub's `CODEOWNERS` file automatically takes care of it, reducing the overhead and potential for error.
- **Documentation and transparency**: The `CODEOWNERS` file serves as a transparent documentation of ownership, which can be beneficial for new team members, auditors, or other stakeholders to understand the responsibility matrix of the project.

## Defining rules

Create a new `CODEOWNERS` file in `./.github` directory first.

### Single owner

If a particular feature is owned by a single team or individual, you can specify it as follows:

```{% path="./.github/CODEOWNERS" %}
features/my_feature.yml @my-team
```

You can also use wildcards (`*`) to specify multiple files following a pattern:

```{% path="./.github/CODEOWNERS" %}
features/payment_*.yml @payments-team
```

### Multiple owners

If a feature is owned by multiple teams or individuals:

```{% path="./.github/CODEOWNERS" %}
features/my_feature.yml @my-team @another-team
```

{% callout type="note" title="Same for segments and attributes" %}
Even though the examples above only mention setting up rules for features, you can do the same for [segments](/docs/segments) and [attributes](/docs/attributes) as well since everything is expressed as files in the Git repository.
{% /callout %}

## Note about branch protection

To ensure that the code owner's review is mandatory, you can set up branch protection rules.

- Go to your repository settings
- Find the "Branches" section, and
- Set up a branch protection rule for your main branch
- Ensure that the "Require review from Code Owners" option is checked

## How does it differ from tagging?

Featurevisor supports [tagging features](/docs/features/#tags) when defining them.

This results into smaller [generated datafiles](/docs/building-datafiles), so that applications can load and consume only the relevant configuration with provided SDKs.

While tagging is useful for filtering, it doesn't provide any security or ownership benefits. It's also not possible to tag attributes or segments. That's where `CODEOWNERS` can help.
