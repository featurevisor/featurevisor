[![Featurevisor](./assets/banner-bordered.png)](https://featurevisor.com)

<div align="center">
  <h3><strong>Feature management for developers</strong></h3>
</div>

<div align="center">
  <small>Manage your feature flags and experiments declaratively from the comfort of your git workflow.</small>
</div>

<br />

<div align="center">
  <!-- NPM version -->
  <a href="https://npmjs.org/package/@featurevisor/sdk">
    <img src="https://img.shields.io/npm/v/@featurevisor/sdk.svg?style=flat-square"
      alt="NPM version" />
  </a>
  <!-- License -->
  <a href="./LICENSE">
    <img src="https://img.shields.io/npm/l/@featurevisor/sdk.svg?style=flat-square"
      alt="License" />
  </a>
</div>

<div align="center">
  <h3>
    <a href="https://featurevisor.com">
      Website
    </a>
    <span> | </span>
    <a href="https://featurevisor.com/docs">
      Documentation
    </a>
    <span> | </span>
    <a href="https://github.com/fahad19/featurevisor/issues">
      Issues
    </a>
    <span> | </span>
    <a href="https://featurevisor.com/docs/contributing">
      Contributing
    </a>
  </h3>
</div>

<div align="center">
  <sub>Built by
  <a href="https://twitter.com/fahad19">@fahad19</a> and
  <a href="https://github.com/fahad19/featurevisor/graphs/contributors">
    contributors
  </a>
</div>

---

- [What is Featurevisor?](#what-is-featurevisor)
- [Quick start](#quick-start)
  - [Part 1: Create a Featurevisor project](#part-1-create-a-featurevisor-project)
  - [Part 2: Build and deploy datafiles](#part-2-build-and-deploy-datafiles)
  - [Part 3: Consume datafiles with Featurevisor SDKs](#part-3-consume-datafiles-with-featurevisor-sdks)
- [Packages](#packages)
- [License](#license)

# What is Featurevisor?

Featurevisor is a solution for managing your feature flags, experiments, and remote config. It's built for developers, by developers.

It introduces a workflow that's fully git-based, where configuration is stored as YAMLs and changes are reviewed and merged via pull requests.

The workflow results into datafiles (JSON files), that contain your feature configurations. These datafiles can then be fetched by your applications and evaluated using Featurevisor SDKs.

More documentation available at [https://featurevisor.com](https://featurevisor.com).

# Quick start

You are recommended to see a more detailed quick start guide here: [https://featurevisor.com/docs/quick-start/](https://featurevisor.com/docs/quick-start/).

The whole process can be broken down into 3 parts:

## Part 1: Create a Featurevisor project

Install Featurevisor CLI globally (or use `npx @featurevisor/cli`):

```
$ npm install -g @featurevisor/cli
```

Initialize a new Featurevisor project:

```
$ mkdir my-featurevisor-project && cd my-featurevisor-project
$ featurevisor init
```

You can now create and manage your feature flags, experiments, and remote config in this directory expressed as YAMLs.

See the building block guides here:

- [Attributes](https://featurevisor.com/docs/attributes/): building block for conditions
- [Segments](https://featurevisor.com/docs/segments/): conditions for targeting users
- [Features](https://featurevisor.com/docs/features/): feature flags and variables with rollout rules

## Part 2: Build and deploy datafiles

Once the project is ready, you can build your datafiles (JSON files containing configuration of your feature flags):

```
$ featurevisor build
```

You will find the output in `dist` directory, that you can upload to your CDN.

See further guides here:

- [Building datafiles](https://featurevisor.com/docs/building-datafiles/): how to build datafiles
- [Deploying datafiles](https://featurevisor.com/docs/deployment/): how to deploy datafiles to your CDN

A fully functioning example for deploying with Cloudflare and GitHub Actions (for free) is available [here](https://github.com/fahad19/featurevisor-example-cloudflare).

## Part 3: Consume datafiles with Featurevisor SDKs

You can now consume the datafiles from your CDN in your applications directly using Featurevisor SDKs.

For Node.js and browser environments, install the JavaScript SDK:

```
$ npm install --save @featurevisor/sdk
```

Now you can initialize the SDK with the URL of your datafile, and evaluate your feature flags:

```js
import { createInstance } from "@featurevisor/sdk";

// Initialize the SDK
const sdk = createInstance({
  datafileUrl: "https://cdn.yoursite.com/datafile.json",
  onReady: () => console.log("Datafile has been fetched and SDK is ready"),
});

// Evaluate a feature flag
const isFeatureEnabled = sdk.getVariation(
  // feature key
  "my-feature",

  // attributes
  {
    userId: "user-123",
    country: "nl",
  }
);
```

Learn more about SDK usage here: [https://featurevisor.com/docs/sdks/](https://featurevisor.com/docs/sdks/).

# Packages

| Package                                 | Description                                |
|-----------------------------------------|--------------------------------------------|
| [@featurevisor/cli](./packages/cli)     | CLI package                                |
| [@featurevisor/core](./packages/core)   | Core package used by CLI                   |
| [@featurevisor/react](./packages/react) | React package                              |
| [@featurevisor/sdk](./packages/sdk)     | Universal SDK for both Node.js and browser |
| [@featurevisor/site](./packages/site)   | Static site generator for your project     |
| [@featurevisor/types](./packages/types) | Common typings                             |
| [@featurevisor/vue](./packages/vue)     | Vue.js package                             |

# License

MIT © [Fahad Heylaal](https://fahad19.com)
