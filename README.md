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
- [Packages](#packages)
- [License](#license)

# What is Featurevisor?

Featurevisor is a solution for managing your feature flags, experiments, and remote config. It's built for developers, by developers.

It introduces a workflow that's fully git-based, where configuration is stored as YAMLs and changes are reviewed and merged via pull requests.

The workflow results into datafiles (JSON files), that contain your feature configurations. These datafiles can then be fetched by your applications and evaluated using Featurevisor SDKs.

More documentation available at [https://featurevisor.com](https://featurevisor.com).

# Packages

| Package                                 | Description                                |
|-----------------------------------------|--------------------------------------------|
| [@featurevisor/cli](./packages/cli)     | CLI package                                |
| [@featurevisor/core](./packages/core)   | Core package used by CLI                   |
| [@featurevisor/types](./packages/types) | Common typings                             |
| [@featurevisor/sdk](./packages/sdk)     | Universal SDK for both Node.js and browser |
| [@featurevisor/react](./packages/react) | React package                              |
| [@featurevisor/site](./packages/site)   | Static site generator for your project     |

# License

MIT © [Fahad Heylaal](https://fahad19.com)
