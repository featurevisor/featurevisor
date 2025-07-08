---
title: Examples
nextjs:
  metadata:
    title: Examples
    description: Example projects with Featurevisor
    openGraph:
      title: Examples
      description: Example projects with Featurevisor
      images:
        - url: /img/og/docs.png
---

## Example projects

You can find example projects on [GitHub](https://github.com/featurevisor/featurevisor) in the [examples](https://github.com/featurevisor/featurevisor/tree/main/examples) directory.

### Default project

By default, initializing command will locally check out the [`example-yml`](https://github.com/featurevisor/featurevisor/tree/main/examples/example-yml) project. As the name suggests, it uses YAML files.

```
$ mkdir my-project && cd my-project
$ npx @featurevisor/cli init
```

### Specific example

You can also initialize a specific example project by passing the `--example` flag.

For JSON:

```
$ npx @featurevisor/cli init --example=json
```

For TOML:

```
$ npx @featurevisor/cli init --example=toml
```

## SDK examples

For SDK integration examples in applications, you can find them in our [GitHub organization](https://github.com/featurevisor) with repos prefixed with [`featurevisor-examples-`](https://github.com/orgs/featurevisor/repositories?q=featurevisor-example&type=all&language=&sort=).
