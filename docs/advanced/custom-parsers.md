---
title: Custom Parsers
description: Learn how to define your own custom parsers for Featurevisor going beyond just YAML and JSON files.
ogImage: /img/og/docs-advanced-custom-parsers.png
---

Featurevisor ships with built-in parsers supporting YAML and JSON files, but you can also take advantage of custom parsers allowing you to define your features and segments in a language you are most comfortable with. {% .lead %}

## Built-in parsers

### YAML

By default, Featurevisor assumes all your definitions are written in YAML and no extra [configuration](/docs/configuration) is needed in that case:

```js
// featurevisor.config.js
module.exports = {
  environments: ["staging", "production"],
  tags: ["all"],

  // optional if value is "yml"
  parser: "yml",
};
```

You can find a example project using YAML [here](https://github.com/featurevisor/featurevisor/tree/main/examples/example-yml).

### JSON

If we wish to use JSON files instead of YAMLs, we can do so by specifying the `parser` option:

```js
// featurevisor.config.js
module.exports = {
  environments: ["staging", "production"],
  tags: ["all"],

  // define the parser to use
  parser: "json",
};
```

You can find a example project using JSON [here](https://github.com/featurevisor/featurevisor/tree/main/examples/example-json).

## Custom

If you wish to define your features and segments in some other language besides YAML and JSON, you can provide your own custom parser.

A parser in this case is a function that takes file content as input (string) and returns a parsed object.

Let's say we wish to use [TOML](https://toml.io/en/) files for our definitions.

We start by installing the [toml](https://www.npmjs.com/package/toml) package:

```
$ npm install --save-dev toml
```

Now we define a custom parser in our [configuration](/docs/configuration):

```js
// featurevisor.config.js
module.exports = {
  environments: ["staging", "production"],
  tags: ["all"],

  // define the parser to use
  parser: {
    extension: "toml",
    parse: (content) => require("toml").parse(content),
  },
}
```

You can find a example project using TOML [here](https://github.com/featurevisor/featurevisor/tree/main/examples/example-toml).
