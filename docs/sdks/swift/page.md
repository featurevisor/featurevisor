---
title: Swift SDK
nextjs:
  metadata:
    title: Swift SDK
    description: Learn how to use Featurevisor Swift SDK
    openGraph:
      title: Swift SDK
      description: Learn how to use Featurevisor Swift SDK
      images:
        - url: /img/og/docs-sdks-swift.png
---

{% callout title="v1 datafiles only supported" type="warning" %}
This SDK does not support latest Featurevisor v2 datafiles yet.

Learn more about building datafiles supporting older SDKS [here](/docs/building-datafiles/#schema-version).
{% /callout %}

Featurevisor Swift SDK can be used in Apple devices targeting several operating systems including: iOS, iPadOS, macOS, tvOS, and watchOS. {% .lead %}

If you don't find what you are looking for or the provided details are insufficient in this page, please check out [Swift SDK](https://github.com/featurevisor/featurevisor-swift) repository on GitHub.

If something is still not clear, please raise an [issue](https://github.com/featurevisor/featurevisor-swift/issues).

## Installation

Swift Package Manager executable requires compilation before running it.

```
$ cd path/to/featurevisor-swift-sdk
$ swift build -c release
$ (cd .build/release && cp -f featurevisor /usr/local/bin/featurevisor-swift)
```

## Initialization

The SDK can be initialized in two different ways depending on your needs.

### Synchronous

You can fetch the datafile content on your own and just pass it via options.

```swift
import FeaturevisorSDK

let datafileContent: DatafileContent = ...
var options: InstanceOptions = .default
options.datafile = datafileContent

let f = try createInstance(options: options)
```

### Asynchronous

If you want to delegate the responsibility of fetching the datafile to the SDK.

```swift
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
let f = try createInstance(options: options)
```

If you need to take further control on how the datafile is fetched, you can pass a custom `handleDatafileFetch` function

```swift
public typealias DatafileFetchHandler = (_ datafileUrl: String) -> Result<DatafileContent, Error>
import FeaturevisorSDK

var options: InstanceOptions = .default
options.handleDatafileFetch = { datafileUrl in
    // you need to return here Result<DatafileContent, Error>
}
let f = try createInstance(options: options)
```

## Context

Contexts are [attribute](/docs/attributes) values that we pass to SDK for evaluating [features](/docs/features).

They are objects where keys are the attribute keys, and values are the attribute values.

```swift
public enum AttributeValue {
    case string(String)
    case integer(Int)
    case double(Double)
    case boolean(Bool)
    case date(Date)
}
```

```swift
import FeaturevisorSDK

let context = [
  "myAttributeKey": .string("myStringAttributeValue"),
  "anotherAttributeKey": .double(0.999),
]
```

## Checking if enabled

Once the SDK is initialized, you can check if a feature is enabled or not:

```swift
import FeaturevisorSDK

let featureKey = "my_feature";
let context = [
    "userId": .string("123"),
    "country": .string("nl")
]

let isEnabled = f.isEnabled(featureKey: featureKey, context: context)
```

## Getting variations

If your feature has any [variations](/docs/features/#variations) defined, you can get evaluate them as follows:

```swift
import FeaturevisorSDK

let featureKey = "my_feature";
let context = [
    "userId": .string("123")
]

let variation = f.getVariation(featureKey: featureKey, context: context)
```

## Getting variables

Your features may also include [variables](/docs/features/#variables):

```swift
import FeaturevisorSDK

let featureKey = "my_feature";
let variableKey = "color"
let context = [
    "userId": .string("123")
]
let variable: VariableValue? = f.getVariable(featureKey: featureKey, variableKey: variableKey, context: context)
```

## Type specific methods

Next `getVariable` methods:

### `boolean`

```swift
let booleanVariable: Bool? = f.getVariableBoolean(featureKey: FeatureKey, variableKey: VariableKey, context: Context)
```

### `string`

```swift
let stringVariable: String? = f.getVariableString(featureKey: FeatureKey, variableKey: VariableKey, context: Context)
```

### `integer`

```swift
let integerVariable: Int? = f.getVariableInteger(featureKey: FeatureKey, variableKey: VariableKey, context: Context)
```

### `double`

```swift
let doubleVariable: Double? = f.getVariableDouble(featureKey: FeatureKey, variableKey: VariableKey, context: Context)
```

### `array`

```swift
let arrayVariable: [String]? = f.getVariableArray(featureKey: FeatureKey, variableKey: VariableKey, context: Context)
```

### `object`

```ts
let objectVariable: MyDecodableObject? = f.getVariableObject(featureKey: FeatureKey, variableKey: VariableKey, context: Context)
```

### `json`

```swift
let jsonVariable: MyJSONDecodableObject? = f.getVariableJSON(featureKey: FeatureKey, variableKey: VariableKey, context: Context)
```

## Activation

Activation is useful when you want to track what features and their variations are exposed to your users.

It works the same as `f.getVariation()` method, but it will also bubble an event up that you can listen to.

```swift
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
options.onActivation = { ... }

let f = try createInstance(options: options)

let featureKey = "my_feature";
let context = [
    "userId": .string("123"),
]

f.activate(featureKey: featureKey, context: context)
```

From the `onActivation` handler, you can send the activation event to your analytics service.

## Initial features

You may want to initialize your SDK with a set of features before SDK has successfully fetched the datafile (if using `datafileUrl` option).

This helps in cases when you fail to fetch the datafile, but you still wish your SDK instance to continue serving a set of sensible default values. And as soon as the datafile is fetched successfully, the SDK will start serving values from there.

```swift
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
options.initialFeatures = [
  "my_feature": .init(enabled: true, variation: "treatment", variables: ["myVariableKey": .string("myVariableValue")]),
  "another_feature": .init(enabled: true, variation: nil, variables: nil)
]

let f = try createInstance(options: options)
```

## Stickiness

Featurevisor relies on consistent bucketing making sure the same user always sees the same variation in a deterministic way. You can learn more about it in [Bucketing](/docs/bucketing) section.

But there are times when your targeting conditions (segments) can change and this may lead to some users being re-bucketed into a different variation. This is where stickiness becomes important.

If you have already identified your user in your application, and know what features should be exposed to them in what variations, you can initialize the SDK with a set of sticky features:

```swift
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
options.stickyFeatures = [
  "my_feature": .init(enabled: true, variation: "treatment", variables: ["myVariableKey": .string("myVariableValue")]),
  "another_feature": .init(enabled: true, variation: nil, variables: nil)
]

let f = try createInstance(options: options)
```

Once initialized with sticky features, the SDK will look for values there first before evaluating the targeting conditions and going through the bucketing process.

You can also set sticky features after the SDK is initialized:

```swift
f.setStickyFeatures(stickyFeatures: [
  "my_feature": .init(enabled: true, variation: "treatment", variables: ["myVariableKey": .string("myVariableValue")])
])
```

This will be handy when you want to:

- update sticky features in the SDK without re-initializing it (or restarting the app), and
- handle evaluation of features for multiple users from the same instance of the SDK (e.g. in a server dealing with incoming requests from multiple users)

## Logging

By default, Featurevisor will log logs in console output window for warn and error levels.

### Levels

```swift
import FeaturevisorSDK

let logger = createLogger(levels: [.error, .warn, .info, .debug])
```

### Handler

You can also pass your own log handler, if you do not wish to print the logs to the console:

```swift
import FeaturevisorSDK

let logger = createLogger(
        levels: [.error, .warn, .info, .debug],
        handle: { level, message, details in ... })

var options = InstanceOptions.default
options.logger = logger

let f = try createInstance(options: options)
```

## Intercepting context

You can intercept context before they are used for evaluation:

```swift
import FeaturevisorSDK

let defaultContext = [
  "country": "nl"
]

var options: InstanceOptions = .default
options.interceptContext = { context in context.merging(defaultContext) { (current, _) in current } }

let f = try createInstance(options: options)
```

This is useful when you wish to add a default set of attributes as context for all your evaluations, giving you the convenience of not having to pass them in every time.

## Refreshing datafile

Refreshing the datafile is convenient when you want to update the datafile in runtime, for example when you want to update the feature variations and variables config without having to restart your application.

It is only possible to refresh datafile in Featurevisor if you are using the `datafileUrl` option when creating your SDK instance.

### Manual refresh

```swift
import FeaturevisorSDK

var options = InstanceOptions.default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"

let f = try createInstance(options: options)

f.refresh()
```

### Refresh by interval

If you want to refresh your datafile every X number of seconds, you can pass the `refreshInterval` option when creating your SDK instance:

```swift
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
options.refreshInterval = 30 // 30 seconds

let f = try createInstance(options: options)
```

You can stop the interval by calling:

```swift
f.stopRefreshing()
```

If you want to resume refreshing:

```swift
f.startRefreshing()
```

### Listening for updates

Every successful refresh will trigger the `onRefresh()` option:

```swift
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
options.onRefresh = { ... }

let f = try createInstance(options: options)
```

Not every refresh is going to be of a new datafile version. If you want to know if datafile content has changed in any particular refresh, you can listen to `onUpdate` option:

```swift
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
options.onUpdate = { ... }

let f = try createInstance(options: options)
```

## Events

Featurevisor SDK implements a simple event emitter that allows you to listen to events that happen in the runtime.

### Listening to events

You can listen to these events that can occur at various stages in your application:

#### `ready`

When the SDK is ready to be used if used in an asynchronous way involving `datafileUrl` option:

```swift
sdk.on?(.ready, { _ in
  // sdk is ready to be used
})
```

The `ready` event is fired maximum once.

You can also synchronously check if the SDK is ready:

```swift
if (f.isReady()) {
  // sdk is ready to be used
}
```

#### `activation`

When a feature is activated:

```swift
sdk.on?(.activation, { _ in })
```

#### `refresh`

When the datafile is refreshed:

```swift
sdk.on?(.refresh, { _ in
  // datafile has been refreshed successfully
})
```

This will only occur if you are using `refreshInterval` option.

#### `update`

When the datafile is refreshed, and new datafile content is different from the previous one:

```swift
sdk.on?(.update, { _ in
  // datafile has been refreshed, and
  // new datafile content is different from the previous one
})
```

This will only occur if you are using `refreshInterval` option.

### Stop listening

You can stop listening to specific events by assgning nil to `off` or by calling `removeListener()`:

```swift
f.off = nil
f.removeListener?(.update, { _ in })
```

### Remove all listeners

If you wish to remove all listeners of any specific event type:

```swift
f.removeAllListeners?(.update)
f.removeAllListeners?(.ready)
```

## Evaluation details

Besides logging with debug level enabled, you can also get more details about how the feature variations and variables are evaluated in the runtime against given context:

```swift
// flag
let evaluation = f.evaluateFlag(featureKey: featureKey, context: context)

// variation
let evaluation = f.evaluateVariation(featureKey: featureKey, context: context)

// variable
let evaluation = f.evaluateVariable(featureKey: featureKey, variableKey: variableKey, context: context)
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
