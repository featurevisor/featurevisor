---
title: What is GitOps?
description: Learn what GitOps mean and how it applies to Featurevisor
ogImage: /img/og/docs-concepts-gitops.png
---

GitOps in its simplest form means operations via Git. This guide will explain further what it is and how it applies to Featurevisor projects. {% .lead %}

## Git

If you have ever worked on a software project, you are probably familiar with [Git](https://git-scm.com/) - a tool for tracking changes in source code. There are several Git hosting providers like [GitHub](https://github.com) and [GitLab](https://gitlab.com) which you might have used already.

But what if we told you that Git could be used for much more than just that? Enter GitOps, a term that's gaining traction in the software engineering community.

## GitOps

GitOps is like treating your infrastructure and operational tasks as if they were code.

Imagine that you have a recipe book (your Git repository) that contains all the instructions (code) for making a dish (your software).

Normally, chefs (developers) would update the recipe book and then cook the dish manually. But what if the kitchen could read the book and update the dish automatically every time the recipe changes?

That's essentially what GitOps does for software deployment and operations. It automates the process of applying changes to your infrastructure based on changes to a Git repository. This makes it easier to manage, track, and roll back changes, all while using familiar tools like Git.

## Why should you care?

- **Declarative**: You define the desired state of your infrastructure in a Git repository in a highly readable format
- **Transparency**: All changes are tracked in Git, so you can easily see who made what change and when.
- **Speed**: Automation means faster deployments, which means you get features and fixes out to users more quickly.
- **Collaboration**: Because everything is stored in Git, team members can easily collaborate on changes through Pull Requests, which go via strict reviews and approval process.
- **Consistency**: Automation ensures that the steps are repeated exactly each time, reducing human error.

## How does it affect Featurevisor?

Featurevisor is an open-source project that falls perfectly in line with the GitOps model. It [manages your features](/docs/feature-management) which can be either on/off switches, variations for A/B testing, or even variables as remote configuration for specific functionalities in your software including their rollout rules.

These [features](/docs/features) are declared as YAML files in a Git repository.

## How does it work?

- **Declare feature flags**: Developers declare feature flags in [YAML](/docs/features) files and store them in a Git repository.
- **Review & approve**: Any changes to feature flags must be submitted as Pull Requests in Git, allowing team members to review and approve changes.
- **Automate with CI/CD**: Featurevisor is tightly integrated with your preferred Continuous Integration/Continuous Deployment (CI/CD) pipeline. When a Pull Request is merged, the pipeline automatically deploys the new configurations.

You can find out more info about setting up custom deployment [here](/docs/deployment).

Once deployed, all the applications that use Featurevisor [SDKs](/docs/sdks) will automatically fetch the latest feature flags and apply them to their respective environments.

## Does it limit non-technical users?

As engineers, we might say that GitOps is the best thing since sliced bread. But what about non-technical users like your Product Managers in a team?

Featurevisor comes with a [status site generator](/docs/site) as well, so that the current status of all your feature flags, their targeting conditions, and rollout rules can be easily viewed by anyone in your team and organization via a nice and usable website.

With Git hosting providers becoming more usable over time allowing changes to be made directly from your browser (like with [GitHub](https://github.com)), one does not have to be technically too advanced to find the YAML files in a Git repository to read and understand them. They can also send changes of their desired feature flags by updating or creating new YAML files straight from the browser.

## Learning resources

Assuming you are using GitHub, you can refer to these resources to learn how to send changes to your Git repository directly from your browser:

- [About branches](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches)
- [Creating a branch](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-and-deleting-branches-within-your-repository)
- [Editing files](https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files)
- [Creating a Pull Request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request)
- [Requesting a review](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/requesting-a-pull-request-review)
- [Comment on a Pull Request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request)
- [Merging a Pull Request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/merging-a-pull-request)

## Conclusion

GitOps is a modern approach to software deployment and operations that leverages the power of Git. Featurevisor, with its GitOps model, provides a highly collaborative, transparent, and efficient way to manage feature flags in a software project. Whether you are a developer, an operations engineer, or a product manager, the GitOps methodology offers benefits that make your workflow smoother, more transparent, and more efficient.
