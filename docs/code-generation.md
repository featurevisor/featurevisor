---
title: Code Generation
description: Generate code from your defined features in Featurevisor.
ogImage: /img/og/docs-code-generation.png
---

For additional compile-time and runtime safety including autocompletion, you can generate code from your already defined features for improved developer experience. {% .lead %}

## Why generate code?

This is an optional step that you may wish to adopt in your workflow. If you do, it will help you avoid some common mistakes:

- any unintentional spelling mistakes in feature and variable keys
- worrying about the types of your variables
- worrying about passing attributes in wrong types in context

All of it done being code-driven, thus reducing overall cognitive load of your team.

## Supported languages

Currently only TypeScript is supported.

Support for other languages is planned in future, as Featurevisor SDK becomes available in more languages.

## Generate code

From the root of your Featurevisor project directory, use the [CLI](/docs/cli) for generating code in a specified directory:

```
$ featurevisor generate-code --language typescript --out-dir ./src
```

The generated files can be found in `./src` directory.

## Publishing the generated code

You are free to use the generated code in any way you want.

You can choose to either:

- copy/paste the code in your applications, or
- publish the generated code as a private npm package and use it in multiple applications

This guide assumes we are publishing it as a private npm package named `@yourorg/features`.

The publishing part can be done in the same [deployment](/docs/deployment) process right after deploying your generated [datafiles](/docs/building-datafiles).

## Consuming the generated code

Initialize Featurevisor SDK as usual, and make your newly created package aware of the SDK instance:

```js
import { createInstance } from "@featurevisor/sdk";
import { setInstance } from "@yourorg/features";

const sdk = createInstance({
  datafileUrl: "https://cdn.yoursite.com/datafile.json",
});

setInstance(sdk);
```

Afterwards, you can import your features from the generated package and evaluate their variations and variables.

## Importing features

Each feature as defined in our Featurevisor project is made available as an individual TypeScript namespace.

If our feature was named `foo` (existing as `features/foo.yml` file), we can import it as follows:

```js
import { FooFeature } from "@yourorg/features";
```

The imported feature will have several methods available depending how it's defined.

Method for checking if the feature is enabled or not is always available:

```js
FooFeature.isEnabled(context = {});
```

If your feature has any defined variations, then `getVariation` method would also be available:

```js
FooFeature.getVariation(context = {});
```

If variables are also defined in the feature, they would be available as:

```js
FooFeature.getMyVariableKey(context = {});
```

## Passing context

You can access the full generated `Context` type as follows:

```js
import { Context } from "@yourorg/features";
```

Passing `context` in all the methods is optional.

The generated code is smart enough to know the types of all your individual attributes as defined in your Featurevisor project as YAMLs.

Therefore, if you pass an attribute in wrong type for evaluating variation or variables, you will get a TypeScript error.

## Checking if enabled

Assuming we have a `foo` feature defined already in `features/foo.yml` file:

```js
import { FooFeature } from "@yourorg/features";

const context = { userId: "user-123" };
const isFooEnabled = FooFeature.isEnabled(context);
```

## Getting variation

We can use the same imported feature to get its variation:

```js
import { FooFeature } from "@yourorg/features";

const context = { userId: "user-123" };
const fooVariation = FooFeature.getVariation(context);
```

## Evaluating variable

If our `foo` feature had a `bar` variable defined, we can evaluate it as follows:

```js
import { FooFeature } from "@yourorg/features";

const context = { userId: "user-123" };
const barValue = FooFeature.getBar(context);
```

The returned value will honour the variable type as defined in the feature's schema originally.

If the variable type is of either `object` or `json`, we can use generics to specify the type of the returned value:

```js
interface MyType {
  someKey: string;
}

const barValue = FooFeature.getBar<MyType>(context);
```

## Accessing keys

To access the literal feature key, use the `key` property of imported feature:

```js
import { FooFeature } from "@yourorg/features";

console.log(FooFeature.key); // "foo"
```

## Suggestions for package publishing

You are advised to publish the generated code as a private npm package, with support for ES Modules (ESM).

When published as ES Modules, it will enable tree-shaking in your applications, thus reducing the bundle size.
