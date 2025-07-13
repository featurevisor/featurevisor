---
title: Frequently Asked Questions
nextjs:
  metadata:
    title: Frequently Asked Questions
    description: Frequently asked questions about Featurevisor
    openGraph:
      title: Frequently Asked Questions
      description: Frequently asked questions about Featurevisor
      images:
        - url: /img/og/docs.png
---

## Is Featurevisor free?

It is an Open Source project, released under the MIT license. You can use it for free.

## Why is it free? Where's the catch?

There's none really. The tool's author is a developer, and he wanted to see how far he can stretch the limits of using declarative files in a Git repository for [feature management](/docs/feature-management) needs.

It worked for him, and now it might work for you as well.

## Is there any UI for managing features?

Featurevisor is a tool aimed at developers, and its entire workflow is based on working with a [Git repository](/docs/concepts/gitops). It is built on top of [Infrastructure as Code (IaC)](/docs/concepts/infrastructure-as-code) principles.

Therefore there is no UI involved when it comes to changing anything. You will be editing files (like in [YAML or JSON](/docs/advanced/custom-parsers)) in your repository, and committing them to Git.

There is a [status site](/docs/site) generator though, which is a static site generated from the repository content you can host internally for your organization in read-only mode.

## Should I use Featurevisor?

It depends.

If you are a team or organization that is open to managing all their feature flags, experiments, or any remote configuration via a Git repository based workflow, then yes, Featurevisor can fit in very nicely.

But an organization can be more than just its engineering team(s), and many other stakeholders might be involved in the process of managing features and experiments, including people who may not know how to use Git. If they need to be involved in the process, then it's best you look for another tool.

## Will Featurevisor ever target non-technical people?

The path to v1.0 has been fully focused on creating a solution that's fully Git based. So it excluded non-technical people from the process as a result, aiming to serve developers only.

There's no plan to change that in the near future.

But, never say never. An Open Source project can always keep evolving.

## Can I switch from another SaaS to Featurevisor?

Yes, you can. But Featurevisor does not provide any migration tool to import your features and experiments from another service (yet).

## Can I switch to another tool or SaaS later?

Given you own everything in your own repository, you can switch to any other tool or third-party SaaS at any time later. There's no lock-in.

You will also be owning the responsibility of migration yourself in that case.

## Do you accept donations?

No, but thanks if you were thinking about it. The author of Featurevisor is doing this for fun and to learn new things by spending his evenings and weekends building this project. He's not looking to make money out of it.

## Can I contribute to Featurevisor?

Yes! Please see our contribution guidelines [here](/docs/contributing).
