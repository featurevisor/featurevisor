---
title: PHP SDK
nextjs:
  metadata:
    title: PHP SDK
    description: Learn how to use Featurevisor PHP SDK
    openGraph:
      title: PHP SDK
      description: Learn how to use Featurevisor PHP SDK
      images:
        - url: /img/og/docs-sdks-php.png
---

Featurevisor's PHP SDK is designed to work seamlessly with your existing PHP applications, both without or with established frameworks like Laravel, CakePHP, or Symfony. {% .lead %}

## Installation

In your PHP application, install the SDK using [Composer](https://getcomposer.org/):

```
$ composer require featurevisor/featurevisor-php
```

## Initialization

The SDK can be initialized by passing [datafile](https://featurevisor.com/docs/building-datafiles/) content directly:

```php
<?php

use function Featurevisor\createInstance;

$datafileUrl = "https://cdn.yoursite.com/datafile.json";

$datafileContent = file_get_contents($datafileUrl);
$datafileContent = json_decode($datafileContent, true);

$f = createInstance([
  "datafile" => $datafileContent
]);
```

## Evaluation types

We can evaluate 3 types of values against a particular [feature](https://featurevisor.com/docs/features/):

- [**Flag**](#check-if-enabled) (`boolean`): whether the feature is enabled or not
- [**Variation**](#getting-variation) (`string`): the variation of the feature (if any)
- [**Variables**](#getting-variables): variable values of the feature (if any)

These evaluations are run against the provided context.

## Context

Contexts are [attribute](https://featurevisor.com/docs/attributes) values that we pass to SDK for evaluating [features](https://featurevisor.com/docs/features) against.

Think of the conditions that you define in your [segments](https://featurevisor.com/docs/segments/), which are used in your feature's [rules](https://featurevisor.com/docs/features/#rules).

They are plain objects:

```php
$context = [
  "userId" => "123",
  "country" => "nl",
  // ...other attributes
];
```

Context can be passed to SDK instance in various different ways, depending on your needs:

### Setting initial context

You can set context at the time of initialization:

```php
use function Featurevisor\createInstance;

$f = createInstance([
  "context" => [
    "deviceId" => "123",
    "country" => "nl",
  ],
]);
```

This is useful for values that don't change too frequently and available at the time of application startup.

### Setting after initialization

You can also set more context after the SDK has been initialized:

```php
$f->setContext([
  "userId" => "123",
  "country" => "nl",
]);
```

This will merge the new context with the existing one (if already set).

### Replacing existing context

If you wish to fully replace the existing context, you can pass `true` in second argument:

```php
$f->setContext(
  [
    "deviceId" => "123",
    "userId" => "234",
    "country" => "nl",
    "browser" => "chrome",
  ],
  true // replace existing context
);
```

### Manually passing context

You can optionally pass additional context manually for each and every evaluation separately, without needing to set it to the SDK instance affecting all evaluations:

```php
$context = [
  "userId" => "123",
  "country" => "nl",
];

$isEnabled = $f->isEnabled('my_feature', $context);
$variation = $f->getVariation('my_feature', $context);
$variableValue = $f->getVariable('my_feature', 'my_variable', $context);
```

When manually passing context, it will merge with existing context set to the SDK instance before evaluating the specific value.

Further details for each evaluation types are described below.

## Check if enabled

Once the SDK is initialized, you can check if a feature is enabled or not:

```php
$featureKey = 'my_feature';

$isEnabled = $f->isEnabled($featureKey);

if ($isEnabled) {
  // do something
}
```

You can also pass additional context per evaluation:

```php
$isEnabled = $f->isEnabled($featureKey, [
  // ...additional context
]);
```

## Getting variation

If your feature has any [variations](https://featurevisor.com/docs/features/#variations) defined, you can evaluate them as follows:

```php
$featureKey = 'my_feature';

$variation = $f->getVariation($featureKey);

if ($variation === "treatment") {
  // do something for treatment variation
} else {
  // handle default/control variation
}
```

Additional context per evaluation can also be passed:

```php
$variation = $f->getVariation($featureKey, [
  // ...additional context
]);
```

## Getting variables

Your features may also include [variables](https://featurevisor.com/docs/features/#variables), which can be evaluated as follows:

```php
$variableKey = 'bgColor';

$bgColorValue = $f->getVariable($featureKey, $variableKey);
```

Additional context per evaluation can also be passed:

```php
$bgColorValue = $f->getVariable($featureKey, $variableKey, [
  // ...additional context
]);
```

### Type specific methods

Next to generic `getVariable()` methods, there are also type specific methods available for convenience:

```php
$f->getVariableBoolean($featureKey, $variableKey, $context = []);
$f->getVariableString($featureKey, $variableKey, $context = []);
$f->getVariableInteger($featureKey, $variableKey, $context = []);
$f->getVariableDouble($featureKey, $variableKey, $context = []);
$f->getVariableArray($featureKey, $variableKey, $context = []);
$f->getVariableObject($featureKey, $variableKey, $context = []);
$f->getVariableJSON($featureKey, $variableKey, $context = []);
```

## Getting all evaluations

You can get evaluations of all features available in the SDK instance:

```php
$allEvaluations = $f->getAllEvaluations($context = []);

print_r($allEvaluations);
// [
//   myFeature: [
//     enabled: true,
//     variation: "control",
//     variables: [
//       myVariableKey: "myVariableValue",
//     ],
//   ],
//
//   anotherFeature: [
//     enabled: true,
//     variation: "treatment",
//   ]
// ]
```

This is handy especially when you want to pass all evaluations from a backend application to the frontend.

## Sticky

For the lifecycle of the SDK instance in your application, you can set some features with sticky values, meaning that they will not be evaluated against the fetched [datafile](https://featurevisor.com/docs/building-datafiles/):

### Initialize with sticky

```php
use function Featurevisor\createInstance;

$f = createInstance([
  "sticky" => [
    "myFeatureKey" => [
      "enabled" => true,

      // optional
      "variation" => 'treatment',
      "variables" => [
        "myVariableKey" => 'myVariableValue',
      ],
    ],

    "anotherFeatureKey" => [
      "enabled" => false,
    ],
  ],
]);
```

Once initialized with sticky features, the SDK will look for values there first before evaluating the targeting conditions and going through the bucketing process.

### Set sticky afterwards

You can also set sticky features after the SDK is initialized:

```php
$f->setSticky(
  [
    "myFeatureKey" => [
      "enabled" => true,
      "variation" => 'treatment',
      "variables" => [
        "myVariableKey" => 'myVariableValue',
      ],
    ],
    "anotherFeatureKey" => [
      "enabled" => false,
    ],
  ],

  // replace existing sticky features (false by default)
  true
]);
```

## Setting datafile

You may also initialize the SDK without passing `datafile`, and set it later on:

```php
$f->setDatafile($datafileContent);
```

### Updating datafile

You can set the datafile as many times as you want in your application, which will result in emitting a [`datafile_set`](#datafile-set) event that you can listen and react to accordingly.

The triggers for setting the datafile again can be:

- periodic updates based on an interval (like every 5 minutes), or
- reacting to:
  - a specific event in your application (like a user action), or
  - an event served via websocket or server-sent events (SSE)

### Interval-based update

Here's an example of using interval-based update:

@TODO

## Logging

By default, Featurevisor SDKs will print out logs to the console for `info` level and above.

### Levels

These are all the available log levels:

- `error`
- `warn`
- `info`
- `debug`

### Customizing levels

If you choose `debug` level to make the logs more verbose, you can set it at the time of SDK initialization.

Setting `debug` level will print out all logs, including `info`, `warn`, and `error` levels.

```php
use function Featurevisor\createInstance;
use function Featurevisor\createLogger;

$f = createInstance([
  "logger" => createLogger([
    "level" => "debug",
  ]),
]);
```

Alternatively, you can also set `logLevel` directly:

```php
$f = createInstance([
  "logLevel" => "debug",
]);
```

You can also set log level from SDK instance afterwards:

```php
$f->setLogLevel("debug");
```

### Handler

You can also pass your own log handler, if you do not wish to print the logs to the console:

```php
use function Featurevisor\createInstance;
use function Featurevisor\createLogger;

$f = createInstance([
  "logger" => createLogger([
    "level" => "info",
    "handler" => function ($level, $message, $details) {
      // do something with the log
    },
  ]),
]);
```

Further log levels like `info` and `debug` will help you understand how the feature variations and variables are evaluated in the runtime against given context.

## Events

Featurevisor SDK implements a simple event emitter that allows you to listen to events that happen in the runtime.

You can listen to these events that can occur at various stages in your application:

@TODO: verify these events

### `datafile_set`

```php
$unsubscribe = $f->on('datafile_set', function ($event) {
  $revision = $event['revision']; // new revision
  $previousRevision = $event['previousRevision'];
  $revisionChanged = $event['revisionChanged']; // true if revision has changed

  // list of feature keys that have new updates,
  // and you should re-evaluate them
  $features = $event['features'];

  // handle here
});

// stop listening to the event
$unsubscribe();
```

The `features` array will contain keys of features that have either been:

- added, or
- updated, or
- removed

compared to the previous datafile content that existed in the SDK instance.

### `context_set`

```php
$unsubscribe = $f->on('context_set', function ($event) {
  $replaced = $event['replaced']; // true if context was replaced
  $context = $event['context']; // the new context

  echo "Context set";
});
```

### `sticky_set`

```php
$unsubscribe = $f->on('sticky_set', function ($event) {
  $replaced = $event['replaced']; // true if sticky features got replaced
  $features = $event['features']; // list of all affected feature keys

  echo "Sticky features set";
});
```

## Evaluation details

Besides logging with debug level enabled, you can also get more details about how the feature variations and variables are evaluated in the runtime against given context:

```php
// flag
$evaluation = $f->evaluateFlag($featureKey, $context = []);

// variation
$evaluation = $f->evaluateVariation($featureKey, $context = []);

// variable
$evaluation = $f->evaluateVariable($featureKey, $variableKey, $context = []);
```

The returned object will always contain the following properties:

- `featureKey`: the feature key
- `reason`: the reason how the value was evaluated

And optionally these properties depending on whether you are evaluating a feature variation or a variable:

- `bucketValue`: the bucket value between 0 and 100,000
- `ruleKey`: the rule key
- `error`: the error object
- `enabled`: if feature itself is enabled or not
- `variation`: the variation object
- `variationValue`: the variation value
- `variableKey`: the variable key
- `variableValue`: the variable value
- `variableSchema`: the variable schema

## Hooks

Hooks allow you to intercept the evaluation process and customize it further as per your needs.

### Defining a hook

A hook is a simple object with a unique required `name` and optional functions:

```php
$myCustomHook = [
  // only required property
  'name' => 'my-custom-hook',

  // rest of the properties below are all optional per hook

  // before evaluation
  'before' => function (options) {
    $type = $options['type']; // `feature` | `variation` | `variable`
    $featureKey = $options['featureKey'];
    $variableKey = $options['variableKey']; // if type is `variable`
    $context = $options['context'];

    // update context before evaluation
    $options['context'] = array_merge($options['context'], [
      'someAdditionalAttribute' => 'value',
    ]);

    return $options;
  },

  // after evaluation
  'after' => function ($evaluation, $options) {
    $reason = $evaluation['reason']; // `error` | `feature_not_found` | `variable_not_found` | ...

    if ($reason === "error") {
      // log error

      return;
    }
  },

  // configure bucket key
  'bucketKey' => function ($options) {
    $featureKey = $options['featureKey'];
    $context = $options['context'];
    $bucketBy = $options['bucketBy'];
    $bucketKey = $options['bucketKey']; // default bucket key

    // return custom bucket key
    return $bucketKey;
  },

  // configure bucket value (between 0 and 100,000)
  'bucketValue' => function ($options) {
    $featureKey = $options['featureKey'];
    $context = $options['context'];
    $bucketKey = $options['bucketKey'];
    $bucketValue = $options['bucketValue']; // default bucket value

    // return custom bucket value
    return $bucketValue;
  },
];
```

### Registering hooks

You can register hooks at the time of SDK initialization:

```php
use function Featurevisor\createInstance;

$f = createInstance([
  'hooks' => [
    $myCustomHook
  ],
]);
```

Or after initialization:

```php
$removeHook = $f->addHook($myCustomHook);

// $removeHook()
```

## Child instance

When dealing with purely client-side applications, it is understandable that there is only one user involved, like in browser or mobile applications.

But when using Featurevisor SDK in server-side applications, where a single server instance can handle multiple user requests simultaneously, it is important to isolate the context for each request.

That's where child instances come in handy:

```php
$childF = $f->spawn([
  // user or request specific context
  'userId' => '123',
]);
```

Now you can pass the child instance where your individual request is being handled, and you can continue to evaluate features targeting that specific user alone:

```php
$isEnabled = $childF->isEnabled('my_feature');
$variation = $childF->getVariation('my_feature');
$variableValue = $childF->getVariable('my_feature', 'my_variable');
```

Similar to parent SDK, child instances also support several additional methods:

- `setContext`
- `setSticky`
- `isEnabled`
- `getVariation`
- `getVariable`
- `getVariableBoolean`
- `getVariableString`
- `getVariableInteger`
- `getVariableDouble`
- `getVariableArray`
- `getVariableObject`
- `getVariableJSON`
- `getAllEvaluations`
- `on`
- `close`

## Close

Both primary and child instances support a `.close()` method, that removes forgotten event listeners (via `on` method) and cleans up any potential memory leaks.

```php
$f->close();
```

## CLI usage


This package also provides a CLI tool for running your Featurevisor project's test specs and benchmarking against this PHP SDK:

### Test

Learn more about testing [here](https://featurevisor.com/docs/testing/).

```
$ vendor/bin/featurevisor test --projectDirectoryPath="/absolute/path/to/your/featurevisor/project"
```

Additional options that are available:

```
$ vendor/bin/featurevisor test \
    --projectDirectoryPath="/absolute/path/to/your/featurevisor/project" \
    --quiet|verbose \
    --onlyFailures \
    --keyPattern="myFeatureKey" \
    --assertionPattern="#1"
```

### Benchmark

Learn more about benchmarking [here](https://featurevisor.com/docs/cli/#benchmarking).

```
$ vendor/bin/featurevisor benchmark \
    --projectDirectoryPath="/absolute/path/to/your/featurevisor/project" \
    --environment="production" \
    --feature="myFeatureKey" \
    --context='{"country": "nl"}' \
    --n=1000
```

### Assess distribution

Learn more about assessing distribution [here](https://featurevisor.com/docs/cli/#assess-distribution).

```
$ vendor/bin/featurevisor assess-distribution \
    --projectDirectoryPath="/absolute/path/to/your/featurevisor/project" \
    --environment=production \
    --feature=foo \
    --variation \
    --context='{"country": "nl"}' \
    --populateUuid=userId \
    --populateUuid=deviceId \
    --n=1000
```

## GitHub repositories

- See SDK repository here: [featurevisor/featurevisor-php](https://github.com/featurevisor/featurevisor-php)
- See example application repository here: [featurevisor/featurevisor-php-example](https://github.com/featurevisor/featurevisor-php-example)
