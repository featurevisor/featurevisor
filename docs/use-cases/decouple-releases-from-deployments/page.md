---
title: Decouple feature releases from application deployments
nextjs:
  metadata:
    title: Decouple feature releases from application deployments
    description: Learn how to decouple your feature releases from your application deployments using Featurevisor.
    openGraph:
      title: Decouple feature releases from application deployments
      description: Learn how to decouple your feature releases from your application deployments using Featurevisor.
      images:
        - url: /img/og/docs-use-cases-decouple-releases-from-deployments.png
---

In today's fast-paced software development world, agility is key. Traditional deployment methods, where every new feature or change requires an application update, can slow down a development team and introduce potential risks. This is where the importance of decoupling comes in. {% .lead %}

Decoupling your application deployments from your feature flags, A/B tests, and remote configurations can bring significant advantages to your development workflow, and Featurevisor is designed to help you achieve just that.

## Benefits

- **Faster time-to-market**: Decoupling allows you to release features as soon as they are developed and tested, without having to wait for the next scheduled application deployment.
- **Reduced risk**: By separating feature releases from application deployments, you can enable or disable features without impacting the entire application, reducing the risk of introducing bugs or other issues.
- **Increased flexibility**: Decoupling enables you to target features to specific user segments or roll them out progressively, giving you greater control over how new functionalities are introduced.
- **Simplified rollbacks**: If a feature introduces unexpected issues, you can easily roll it back without having to revert the entire application deployment.
- **Resource optimization**: Your development and operations teams can focus on their respective tasks more efficiently, as they are not tied up coordinating large-scale deployments for every new feature.
- **Better user experience**: You can introduce new features or changes progressively, gathering user feedback and making adjustments in real-time, without forcing users to update/refresh the apps, thus improving the overall user experience.

## How Featurevisor helps achieve decoupling

### Independent Git repository

With Featurevisor, your feature configurations are stored in a separate Git repository. This repository acts as your Featurevisor project, completely independent of your application's codebase.

### GitOps workflow

Featurevisor adopts a [GitOps workflow](/docs/concepts/gitops), ensuring that all changes to your feature flags or configurations go through Pull Requests.

This makes the process of adding or modifying features transparent and auditable in one single place for your entire organization, irrespective of how many different applications or services you have.

### Datafile and CDN

When Pull Requests are merged into your Featurevisor project, it automatically [builds datafiles](/docs/building-datafiles) (static JSON configuration files) and [deploys](/docs/deployment) them to your preferred CDN.

Your applications can then consume these datafiles at runtime using provided [SDKs](/docs/sdks).

### Real-time changes

Because your applications consume datafiles from the CDN, any changes to your feature configurations are propagated in real-time. This means you can toggle features on or off instantly without having to redeploy your applications.

### Cloud-Native and language agnostic

Featurevisor is [cloud-native](/docs/concepts/cloud-native-architecture) and can be used with any programming language (assuming their SDK exists already), giving you the flexibility to integrate it into any part of your stack, be it frontend or backend.

## Conclusion

Decoupling application deployments from feature releases offers numerous advantages in terms of risk reduction, speed, and efficiency. Featurevisor provides a robust set of tools to help you achieve this decoupling, making it easier to manage your features in a more agile, responsive manner.

By adopting Featurevisor, you are not just adding another tool to your stack; you are adopting a smarter way to manage features and deliver value to your users.
