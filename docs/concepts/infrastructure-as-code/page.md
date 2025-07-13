---
title: Infrastructure as Code (IaC)
nextjs:
  metadata:
    title: Infrastructure as Code (IaC)
    description: Learn what Infrastructure as Code (IaC) means and how it applies to Featurevisor.
    openGraph:
      title: Infrastructure as Code (IaC)
      description: Learn what Infrastructure as Code (IaC) means and how it applies to Featurevisor.
      images:
        - url: /img/og/docs-concepts-iac.png
---

Infrastructure as Code (IaC) is the practice of managing and provisioning computing resources through human-readable yet machine-parsable files written in a declarative format. {% .lead %}

Instead of manually configuring your infrastructure or using one-off scripts, IaC allows you to apply consistent settings across multiple environments, making the setup reproducible and easily versioned.

## Understanding infrastructure

Before diving further into how Featurevisor adopts IaC principles, it's essential to understand what "**infrastructure**" means in the context of IaC.

It refers to the various components that together form the operational environment where your software runs. This infrastructure may include:

- **Compute resources**: servers and containers
- **Networking components**: network configuration, load balancers, firewalls
- **Storage elements**: databases and file storage
- **Software & applications**: operating systems, dependencies, and applications
- **Security mechanisms**: access control and encryption tools
- **Management & monitoring**: configuration, monitoring and alerting systems
- **Deployment tools**: CI/CD pipelines and automation tools

These components, when managed and provisioned as (declarative) code, enhance automation, consistency, and scalability, streamlining the development and deployment processes.

## Key characteristics

- **Declarative syntax**: IaC uses a declarative approach, meaning you specify "**what**" you want to achieve, not "**how**" to achieve it. The system interprets the code to bring the environment to the desired state.
- **Version control**: All configurations are stored in a version control system like [Git](/docs/concepts/gitops), providing a historical record and enabling rollback capabilities.
- **Automation**: IaC is often integrated into a CI/CD (Continuous Integration/Continuous Deployment) pipeline, automating the deployment process and minimizing human error.
- **Modularity & reusability**: IaC encourages modular configurations, which can be reused across different projects or environments.

## What does declarative approach mean?

Declarative approach means that you specify the desired state of your infrastructure, and the system takes care of the rest.

This means you express your desired state from the system as files in (usually) one of these formats, which are human-readable yet machine-parsable:

- [YAML](https://en.wikipedia.org/wiki/YAML) (Featurevisor uses this by default)
- [JSON](https://en.wikipedia.org/wiki/JSON)
- [TOML](https://toml.io/en/)
- [HCL](https://github.com/hashicorp/hcl)

Refer to our [custom parser guide](/docs/advanced/custom-parsers) to learn how to use other formats.

## How does it apply to Featurevisor?

Featurevisor takes the principles of IaC and [GitOps](/docs/concepts/gitops) and applies them to [feature management](/docs/feature-management).

Here's how:

### GitOps workflow

In Featurevisor, all feature configurations are stored in a Git repository and managed via a GitOps workflow. This ensures that changes are reviewed, approved, versioned, and auditable, just like you would expect with IaC.

### Declarative configuration

Featurevisor allows you to define all your feature flags, A/B tests, and other configurations in files written in a language of your choosing (like YAML, JSON, or TOML). This provides a human-readable, yet machine-parsable, way to manage features.

Just like IaC, this is a declarative approach. You specify what you want to happen with your features, and Featurevisor takes care of the rest.

{% callout type="note" title="Featurevisor's building blocks" %}
Each of these are expressed as separate files:

- [Attributes](/docs/attributes): building block for conditions
- [Segments](/docs/segments): reusable conditions for targeting users
- [Features](/docs/features): feature flags and experiments with rollout rules
- [Groups](/docs/groups): for mutually exclusive features and experiments

{% /callout %}

### Automation with CI/CD

Once changes are merged into the main or master branch of your Git repository, Featurevisor automates the propagation of these configurations to your live environment via CI/CD pipelines.

Since Featurevisor is [cloud native](/docs/concepts/cloud-native-architecture), it can be integrated with any CI/CD tool of your choice.

### Modularity

[Feature](/docs/features) configurations in Featurevisor can be modular, meaning you can have separate configurations for different features against different environments.

You can also define reusable targeting conditions as [segments](/docs/segments) and apply in different features' rollout rules.

This promotes reusability and makes it easier to manage complex systems.

## Other examples

These are various popular open source projects that adopt IaC principles:

- [Terraform](https://www.terraform.io/): Infrastructure provisioning
- [Kubernetes](https://kubernetes.io/): Container orchestration
- [Docker](https://www.docker.com/): Containerization
- [AWS CloudFormation](https://aws.amazon.com/cloudformation/): Infrastructure provisioning
- [Azure Resource Manager](https://azure.microsoft.com/en-us/features/resource-manager/): Infrastructure provisioning
- [Google Cloud Deployment Manager](https://cloud.google.com/deployment-manager): Infrastructure provisioning

## Conclusion

Featurevisor successfully extends the principles of Infrastructure as Code to the realm of feature management. By doing so, it offers a robust, version-controlled, and automated approach to manage your application's features.

Whether you're a developer, a system admin, or a product manager, understanding the IaC principles behind Featurevisor can help you manage features more effectively and efficiently.
