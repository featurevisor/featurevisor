---
title: Swift SDK
description: Learn how to use Featurevisor Swift SDK
ogImage: /img/og/docs-sdks-swift.png
---

## Installation

Swift Package Manager executable requires compilation before running it.

```bash
$ cd path/to/featurevisor-swift-sdk
$ swift build -c release
$ cd .build/release
$ cp -f featurevisor /usr/local/bin/featurevisor-swift
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
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
options.onReady = { ... }

let f = try createInstance(options: options)
```

The `ready` event is fired maximum once.

You can also synchronously check if the SDK is ready:

```swift
if f.isReady() {
  // sdk is ready to be used
}
```

#### `activation`

When a feature is activated:

```swift
import FeaturevisorSDK

var options: InstanceOptions = .default
options.datafileUrl = "https://cdn.yoursite.com/production/datafile-tag-all.json"
options.onActivation = { ... }

let f = try createInstance(options: options)
```
