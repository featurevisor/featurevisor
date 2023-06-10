---
title: Frequently Asked Questions
description: Frequently asked questions about Featurevisor
---

## Is Featurevisor free?

It is an Open Source project, released under the MIT license. You can use it for free.

## Why is it free? Where's the catch?

There's none really. The tool's author is a developer, and he wanted to see how far he can stretch the limits of YAMLs in a git repository for feature management.

The tool started as an experiment itself, but after several releases and iterations, it is increasingly becoming a stable tool that can be used in production.

## Is there any UI for managing features?

Featurevisor is a tool aimed at developers, and its entire workflow is based on working with a Git repository.

Therefore there is no UI involved when it comes to changing anything. You will be editing YAML files in your repository, and committing them to Git.

Except for the [status site](/docs/site), which is a static site generated from the repository content.

## Should I use Featurevisor?

It depends.

If you are a team or organization that is open to managing all their feature flags, experiments, or any remote configuration via a Git repository based workflow, then yes, Featurevisor can fit in nicely.

But until v1.0 stable has landed, you should be prepared to deal with some bugs and issues.

## Can I switch to another tool or SaaS later?

Given you own everything in your own repository, you can switch to any other tool or third-party SaaS at any time later. There's no lock-in.

You will also be owning the responsibility of migration yourself in that case.

## Can I switch from another SaaS to Featurevisor?

Yes, you can. But Featurevisor does not provide any migration tool to import your features and experiments from another service (yet).
