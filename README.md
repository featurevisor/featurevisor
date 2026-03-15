[![Featurevisor](./assets/banner-bordered.png)](https://featurevisor.com)

<div align="center">
  <h3><strong>Feature management with version control</strong></h3>
</div>

<div align="center">
  <small>Manage your feature flags, experiment variations, variables for remote configuration<br />declaratively from the comfort of your Git workflow.</small>
</div>

<div align="center">
  <h3>
    <a href="https://featurevisor.com">
      Website
    </a>
    <span> | </span>
    <a href="https://featurevisor.com/docs/quick-start">
      Documentation
    </a>
    <span> | </span>
    <a href="https://github.com/featurevisor/featurevisor/issues">
      Issues
    </a>
    <span> | </span>
    <a href="https://featurevisor.com/docs/contributing">
      Contributing
    </a>
    <span> | </span>
    <a href="https://github.com/featurevisor/featurevisor/blob/main/CHANGELOG.md">
      Changelog
    </a>
  </h3>
</div>

<div align="center">
  <sub>Built by
  <a href="https://twitter.com/fahad19">@fahad19</a> and
  <a href="https://github.com/featurevisor/featurevisor/graphs/contributors">
    contributors
  </a>
</div>

---

## How does it work?

Three simple steps to visualize it:

[![Featurevisor](./assets/flow.png)](https://featurevisor.com)

1. Manage your Featurevisor [project](https://featurevisor.com/docs/project) in a Git repository
1. Build and upload [datafiles](https://featurevisor.com/docs/building-datafiles) (static JSON files) to your CDN or custom server
1. Fetch the datafile in your application, and evaluate features using [SDKs](https://featurevisor.com/docs/sdks)

## What do I need to bring to use Featurevisor?

- A Git repository for managing your [project](https://featurevisor.com/docs/project) declaratively
- A CI/CD pipeline (like [GitHub Actions](https://featurevisor.com/docs/integrations/github-actions/)) for building and uploading [datafiles](https://featurevisor.com/docs/building-datafiles)
- A CDN or custom server for serving the generated [datafiles](https://featurevisor.com/docs/building-datafiles)

Featurevisor [SDKs](https://featurevisor.com/docs/sdks/javascript) will take care of the rest for you.

## Understanding the building blocks

Three core building blocks of a Featurevisor [project](https://featurevisor.com/docs/project) are:

- [Attributes](https://featurevisor.com/docs/attributes/): building block for conditions
- [Segments](https://featurevisor.com/docs/segments/): reusable conditions for targeting users
- [Features](https://featurevisor.com/docs/features/): features with flag, variation, and variable definitions

SDKs are used in your application(s) to evaluate three different types of values belonging to your defined [features](https://featurevisor.com/docs/features/) against your provided [context](https://featurevisor.com/docs/sdks/javascript/#context) in the runtime:

- [Flags](https://featurevisor.com/docs/flags/): on/off values against rules
- [Variations](https://featurevisor.com/docs/variations/): string values for A/B tests
- [Variables](https://featurevisor.com/docs/variables/): key/value pairs for remote configuration

## FeaturevisorSDKs

[![SDKs](./assets/sdks.png)](https://featurevisor.com/docs/sdks/)

Supported SDKs include:

- [JavaScript](https://featurevisor.com/docs/sdks/javascript) (both Node.js and browser environments)
- [React](https://featurevisor.com/docs/react/)
- [React Native](https://featurevisor.com/docs/react-native/)
- [Go](https://featurevisor.com/docs/sdks/go/)
- [Python](https://featurevisor.com/docs/sdks/python/)
- [PHP](https://featurevisor.com/docs/sdks/php/)
- [Ruby](https://featurevisor.com/docs/sdks/ruby/)
- [Java](https://featurevisor.com/docs/sdks/java/)
- [Swift](https://featurevisor.com/docs/sdks/swift/)
- [Next.js](https://featurevisor.com/docs/frameworks/nextjs/)
- [Vue.js](https://featurevisor.com/docs/vue/)

## Why should I use Featurevisor?

Several use cases include:

- [Decoupling application deployments from feature releases](https://featurevisor.com/docs/use-cases/decouple-releases-from-deployments/)
- [Progressive delivery with gradual rollout of features](https://featurevisor.com/docs/use-cases/progressive-delivery/)
- [Testing in production](https://featurevisor.com/docs/use-cases/testing-in-production/)
- [Experiment with A/B and Multivariate tests](https://featurevisor.com/docs/use-cases/experiments/)
- [Role-based feature gating](https://featurevisor.com/docs/use-cases/entitlements/)
- [Remote configuration with advanced variables](https://featurevisor.com/docs/use-cases/remote-configuration/)
- [Establishing feature ownership and governance](https://featurevisor.com/docs/use-cases/establishing-ownership/)
- [Trunk based development](https://featurevisor.com/docs/use-cases/trunk-based-development/)
- [Aligning multiple teams in a microfrontends architecture](https://featurevisor.com/docs/use-cases/microfrontends/)
- [Feature depdendencies management](https://featurevisor.com/docs/use-cases/dependencies/)
- [Deprecating features safely](https://featurevisor.com/docs/use-cases/deprecation/)

# License

MIT © [Fahad Heylaal](https://fahad19.com)
