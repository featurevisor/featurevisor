---
title: Feature management
description: Learn what feature management is all about and how to use it to roll out new features safely.
---

It is best to consider feature management as a **practice** rather than a **tool**. {% .lead %}

## Decoupling deployment from release

One of the primary use cases of feature management is to decouple deployments from releases.

When you deploy a new version of your software, it doesn't mean that all the new fancy features you built have to be exposed to all your users right away. You may decide to roll it out slowly to a tiny percentage of your traffic frist, and then gradually increase the percentage of users that are exposed to the new feature as you get enough positive feedback.

Alternatively, you may even want to disable a feature that you just released completely.

To summarize:

* **Deployment**: when you ship new version of your software
* **Release**: when you expose a new feature to your users

## Feature management vs feature flags

While feature management itself is a practice, feature flags are an implementation of conditional statements that act as on/off switches in your application.

Featurevisor takes the concept of feature flags a step further by introducing multivariates which go beyond traditional boolean values.

## Feature management and experimentation

Product development is a continuous process of experimentation and learning. You can't just build a feature and release it to your users and expect it to be successful. You need to test it out, and learn from the feedback you get from your users. It can take numerous iterations before you achieve your product-market fit.

Feature management is a great way to experiment with new features of your product, and learn from the feedback you get from your users. Simple on/off switches are not enough to do this. You need to be able to test out multiple variations of your feature, and see which one performs the best.

That's where A/B testing and multivariate testing come in. You can define multiple variations of your feature, and expose them to a small percentage of your users. You can then measure the performance of each variation, and decide which one to roll out to the rest of your users.

## Establishing a workflow

Like your application, your team and organization can grow and so will the number of features you manage. It is important to establish a workflow that is scalable and sustainable.

You do not want someone to randomly turn off a very important feature that can lead to serious outage in your application. You also don't want any team member to expose a new feature to all your users right away, without testing it out first.

Featurevisor provides a set of tools that help you establish such a workflow using the well-known Git workflow.

Worklfow:

- Team member send Pull Requests to create and update features
- Team reviews it together and merges it
- CI builds the datafiles and deploys (uploads) them to the CDN
- Applications consumes the datafiles in relevant environments
