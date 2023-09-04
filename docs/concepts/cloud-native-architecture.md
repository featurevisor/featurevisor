---
title: Cloud Native Architecture
description: Learn what being Cloud Native means and how it applies to Featurevisor
ogImage: /img/og/docs-concepts-cloud-native.png
---

Featurevisor is agnostic of what CI/CD tool you use for your deployment, and also is not opinionated on how you store the generated datafiles making it a cloud native solution that you can customize as per your needs. {% .lead %}

Before we dive into how Featurevisor leverages cloud native principles, let's first clarify what "**cloud native**" means.

## What is Cloud Native?

Cloud native refers to a way of building and running applications that fully leverage the advantages of cloud computing. Instead of traditional methods, where software might be designed to run on a specific set of servers, cloud native applications are built to be flexible, scalable, and resilient.

They are designed to run in a cloud environment where resources can be easily added or removed as needed.

## Key Benefits of Cloud Native

* **Scalability**: Easily adjust to handle more users or data.
* **Flexibility**: Run your services wherever you want — be it AWS, Google Cloud, Azure, or a private cloud.
* **Resilience**: Built-in fault tolerance means less downtime.
* **Speed**: Deploy updates and new features much more quickly.

## Cloud Native in Featurevisor

Featurevisor is an open source project designed for managing feature flags, experiments, and remote configuration for your applications. It's built with a cloud native architecture, allowing it to seamlessly integrate with various cloud services.

In its simplest form, all it requires is a CI/CD pipeline and a CDN for hosting generated static JSON files.

## How does it work?

* **Declarative configuration**: Featurevisor allows users to define feature flags and their configuration in a straightforward, [declarative](/docs/features) manner. This means you specify what you want the system to do, not how to do it.
* **GitOps Workflow**: In true cloud native fashion, Featurevisor adopts a [GitOps](/docs/concepts/gitops) approach. All changes are made via Pull Requests, reviewed, and then automatically deployed by a CI/CD (Continuous Integration/Continuous Deployment) pipeline.
* **Unopinionated infrastructure**: Featurevisor doesn’t tie you down to a specific cloud provider or service. Whether you're using GitHub, GitLab, Jenkins, or any CDN for static file hosting, Featurevisor is designed to work smoothly.
* **Static JSON datafiles**: The configuration files, known as [datafiles](/docs/building-datafiles), are static JSON files. Every time a Pull Request is merged to the master branch, a new build is triggered, producing these datafiles. They are then [deployed](/docs/deployment) to a CDN (Content Delivery Network), ensuring fast and reliable delivery.


## What Does This Mean for You?

* **Flexibility**: You're not locked into a specific tech stack. Choose the Git provider, CI/CD tool, and CDN that best suit your needs.
* **Transparency**: Every change goes through a Pull Request, making it easier to track who made what change and why.
* **Speed**: Thanks to the CI/CD pipeline, changes can be deployed quickly and automatically.

## Conclusion

Cloud native is more than just a buzzword; it’s a powerful approach to building robust, scalable, and flexible software. Featurevisor embodies these principles by offering an open-source, cloud native solution for managing feature flags. Whether you're a developer, either focused on product engineering or DevOps, or a product manager, Featurevisor provides a streamlined, efficient way to manage your software's features while reaping the benefits of cloud native architecture.
