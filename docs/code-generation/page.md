---
title: Code Generation
nextjs:
  metadata:
    title: Code Generation
    description: Generate code from your defined features in Featurevisor.
    openGraph:
      title: Code Generation
      description: Generate code from your defined features in Featurevisor.
      images:
        - url: /img/og/docs-code-generation.png
---

For additional compile-time and runtime safety including autocompletion, we can generate code from our already defined [features](/docs/features) for improved developer experience. {% .lead %}

## Why generate code?

This is an optional step that we may wish to adopt in our workflow. If we do, it will help us avoid some common mistakes:

- any unintentional spelling mistakes in [feature](/docs/features) and variable keys
- worrying about the types of our [variables](/docs/features/#variables)
- worrying about passing attributes in wrong types in [context](/docs/sdks/javascript/#context)

All of it done being code-driven, thus reducing overall cognitive load of multiple teams.

## Supported languages

Currently only TypeScript is supported.

Support for other languages is planned in future, as Featurevisor SDK becomes available in more languages.

## Generate code

From the root of our Featurevisor project directory, use the [CLI](/docs/cli) for generating code in a specified directory:

```{% title="Command" %}
$ npx featurevisor generate-code \
    --language typescript \
    --out-dir ./src \
    --react \
    --no-individual-features
```

The generated files can be found in `./src` directory.

Optional flags:

- `--tag=<tag>`: generate code only for features with the given tag
- `--react`: also generate typed React hooks in `React.ts`
- `--no-individual-features`: skip generating per-feature `*Feature.ts` files

## Publishing the generated code

We are free to use the generated code in any way we want.

We can choose to either:

- copy/paste the code in our applications, or
- publish the generated code as a private npm package and use it in multiple applications, like as `@yourorg/features` package

The publishing part can be done in the same [deployment](/docs/deployment) process right after deploying our generated [datafiles](/docs/building-datafiles).

## Consuming the generated code

Assuming we published the generated code as a private npm package `@yourorg/features`, we can consume it in our applications as follows.

Initialize Featurevisor [SDK](/docs/sdks/javascript) as usual, and make our newly created package aware of the SDK instance:

```js {% path="your-app/index.js" %}
import { createInstance } from '@featurevisor/sdk'
import { setInstance } from '@yourorg/features'

const f = createInstance({
  // ...
})

setInstance(f)
```

Afterwards, we can import a common set of functions which are already aware of which feature keys we are allowed to use including their variable keys.

## Importing functions

Similar to [JavaScript SDK](/docs/sdks/javascript)'s methods `isEnabled`, `getVariation`, and `getVariable`, we can import these functions with the same names:

```js
import { isEnabled, getVariation, getVariable } from '@yourorg/features'

const featureIsEnabled = isEnabled('featureKey')
const featureVariation = getVariation('featureKey')
const featureVariable  = getVariable('featureKey', 'variableKey')
```

We can optionally pass additional [context](/docs/sdks/javascript/#context) as the last argument:

```js
const context = {
  userId: '123',
}

const featureIsEnabled = isEnabled('featureKey', context)
const featureVariation = getVariation('featureKey', context)
const featureVariable  = getVariable('featureKey', 'variableKey', context)
```

Everything here is typed as per our defined [features](/docs/features).

If we pass a wrong feature key, or a variable key that does not belong to the same feature, we will get a TypeScript error.

## Importing React hooks

If we passed `--react` in CLI, we can import React hooks with the same names as the original package [`@featurevisor/react`](/docs/react):

```js
import { useFlag, useVariation, useVariable } from '@yourorg/features'

const isEnabled = useFlag('featureKey')
const variation = useVariation('featureKey')
const variable  = useVariable('featureKey', 'variableKey')
```

Passing any wrong feature key or variable key combination will result in a TypeScript error.

We can optionally pass additional [context](/docs/sdks/javascript/#context) as the last argument:

```js
const context = {
  userId: '123',
}

const isEnabled = useFlag('featureKey', context)
const variation = useVariation('featureKey', context)
const variable  = useVariable('featureKey', 'variableKey', context)
```

## Importing features (legacy)

This will only work if we didn't pass `--no-individual-features` in CLI.

Each feature as defined in our Featurevisor project is made available as an individual TypeScript namespace.

If our feature was named `foo` (existing as `features/foo.yml` file), we can import it as follows:

```js
import { FooFeature } from '@yourorg/features'
```

The imported feature will have several methods available depending how it's defined.

The method for checking if the feature is enabled or not is always available:

```js
FooFeature.isEnabled((context = {}))
```

If our feature has any defined variations, then the `getVariation` method would also be available:

```js
FooFeature.getVariation((context = {}))
```

If variables are also defined in the feature, they would be available as:

```js
FooFeature.getMyVariableKey((context = {}))
```

### Passing context

We can access the full generated `Context` type as follows:

```js
import { Context } from '@yourorg/features'
```

Passing `context` in all the methods is optional.

The generated code is smart enough to know the types of all your individual attributes as defined in your Featurevisor project.

Therefore, if you pass an attribute in wrong type for evaluating variation or variables, you will get a TypeScript error.

### Checking if enabled

Assuming we have a `foo` feature defined already in `features/foo.yml` file:

```js
import { FooFeature } from '@yourorg/features'

const context = { userId: 'user-123' }
const isFooEnabled = FooFeature.isEnabled(context)
```

### Getting variation

We can use the same imported feature to get its variation:

```js
import { FooFeature } from '@yourorg/features'

const context = { userId: 'user-123' }
const fooVariation = FooFeature.getVariation(context)
```

### Evaluating variable

If our `foo` feature had a `bar` variable defined, we can evaluate it as follows:

```js
import { FooFeature } from '@yourorg/features'

const context = { userId: 'user-123' }
const barValue = FooFeature.getBar(context)
```

The returned value will honour the variable type as defined in the feature's schema originally.

If the variable type is of either `object` or `json`, we can use generics to specify the type of the returned value:

```js
interface MyType {
  someKey: string;
}

const barValue = FooFeature.getBar<MyType>(context);
```

### Accessing keys

To access the literal feature key, use the `key` property of imported feature:

```js
import { FooFeature } from '@yourorg/features'

console.log(FooFeature.key) // "foo"
```

## Suggestions for package publishing

You are advised to publish the generated code as a private npm package, with support for ES Modules (ESM).

When published as ES Modules, it will enable tree-shaking in your applications, thus reducing the bundle size.
