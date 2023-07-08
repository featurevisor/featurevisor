---
title: Code Generation
description: Generate code from your defined features in Featurevisor.
ogImage: /img/og/docs-code-generation.png
---

For additional runtime safety and autocompletion, you can generate code from your already defined features for improved developer experience. {% .lead %}

## Supported languages

Currently only TypeScript is supported.

Support for other languages is planned in future.

## Generate code

Use Featurevisor CLI for generating code in a specified directory:

```
$ featurevisor generate-code --language typescript --out-dir ./src
```

The generated files can be found in `./src` directory.

## Publishing the generated code

You are free to use the generated code in any way you want.

You can choose to:

- copy/paste the code in your applications, or
- publish the generated code as a private npm package and use it in multiple applications

This guide assumes we are publishing it as a private npm package named `@yourorg/features`.

The publishing part can be done in the same [deployment](/docs/deployment) process right after deploying your generated [datafiles](/docs/building-datafiles).

## Consuming the generated code

Initialize Featurevisor SDK as usual, and make your newly created package aware of the SDK instance:

```js
import { createInstance } from '@featurevisor/sdk';
import { setInstance } from '@yourorg/features';

const sdk = createInstance({
  datafileUrl: 'https://cdn.yoursite.com/datafile.json',
});

setInstance(sdk);
```

Afterwards, you can import your features from the generated package and evaluate their variations and variables.

## Importing features

Each feature as defined in our Featurevisor project is made available as an individual TypeScript namespace.

If our feature was named `foo` (existing as `features/foo.yml` file), we can import it as follows:

```js
import { FooFeature } from '@yourorg/features';
```

The imported feature will have several methods available depending how it's defined.

Method for getting its variation is always available:

```js
FooFeature.getVariation(attributes = {});
```

If variables are also defined in the feature, they would be available as:

```js
FooFeature.getMyVariableKey(attributes = {});
```

## Passing attributes

You can access the full generated `Attributes` type as follows:

```js
import { Attributes } from "@yourorg/features";
```

Passing `attributes` in all the methods is optional.

The generated code is smart enough to know the types of all your individual attributes as defined in your Featurevisor project as YAMLs.

Therefore, if you pass an attribute in wrong type for evaluating variation or variables, you will get a TypeScript error.

## Getting variation

Assuming we have a `foo` feature defined already, which has `boolean` variations:

```js
import { FooFeature } from '@yourorg/features';

const attributes = {};
const fooIsEnabled = FooFeature.getVariation(attributes);

typeof fooIsEnabled === 'boolean'; // true
```

If our defined feature had `string` variations instead, the returned type would of course be `string`:

```js
const fooVariation = FooFeature.getVariation();

typeof fooVariation === 'string'; // true
```

## Evaluating variable

If our `foo` feature had a `bar` variable defined, we can evaluate it as follows:

```js
import { FooFeature } from '@yourorg/features';

const attributes = {};
const barValue = FooFeature.getBar(attributes);
```

The returned value will honour the variable type as defined in the feature's schema originally.

If the variable type is of either `object` or `json`, we can use generics to specify the type of the returned value:

```js
interface MyType {
  someKey: string;
}

const barValue = FooFeature.getBar<MyType>(attributes);
```
