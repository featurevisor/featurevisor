---
title: Roku SDK
nextjs:
  metadata:
    title: Roku SDK
    description: Learn how to use Featurevisor Roku SDK
    openGraph:
      title: Roku SDK
      description: Learn how to use Featurevisor Roku SDK
      images:
        - url: /img/og/docs-sdks-roku.png
---

{% callout title="v1 datafiles only supported" type="warning" %}
This SDK does not support latest Featurevisor v2 datafiles yet.

Learn more about building datafiles supporting older SDKS [here](/docs/building-datafiles/#schema-version).
{% /callout %}

BrightScript SDK for Roku is meant to be used with [kopytko-framework](https://github.com/getndazn/kopytko-framework). {% .lead %}

However, if you don't use it, you can simply copy all SDK files and their dependencies to your project (a version will be prepared in the future if anyone is interested).

## Installation

Install with npm:

```bash
npm i -P @featurevisor/roku
```

## Introduction

The BrightScript implementation is a bit different than the JS one, as in BrightScript to be able to keep our instance separated and keep it globally, the SDK would need to be a SceneGraph Node. But to provide a bit similar API to the JS SDK we have introduced 2 main entities. One is the `FeaturevisorInstance` node, and the other is the function `FeaturevisorSDK` (that returns an object with methods mirroring JS SDK functions). The `FeaturevisorSDK` operates on the `FeaturevisorInstance` that is created by it or passed to it.

**That's why all functions presented in this documentation are `FeaturevisorSDK` methods (or exactly, of the object returned by `FeaturevisorSDK()`)**

There are a couple of methods to handle Featurevisor in your Roku App, for example:

- create a new SceneGraph Node that will save in its context the FeaturevisorSDK() and create your abstraction based on FeaturevisorSDK. Later save this whole node globally
- create with FeaturevisorSDK an instance that you will save globally and later pass each time to `FeaturevisorSDK().createInstance({}, existingInstance)` before using its methods.

For this documentation, we assume there will be a new node created for the integration (first variant).
We will call it `MyFeaturevisorInstance` and all code will be invoked inside this node (in the `MyFeaturevisorInstance.brs` for the below example).
The value returned by `FeaturevisorSDK()` will be called `f`, or if needed saved in the context - `m.f`.

XML definition:

```xml
<?xml version="1.0" encoding="utf-8" ?>

<component name="MyFeaturevisorInstance" extends="Node">
  <interface>
    <!-- Fields and Functions you want to expose -->
  </interface>

  <script type="text/brightscript" uri="MyFeaturevisorInstance.brs" />
</component>
```

## Initialization

The SDK can create a new instance or accept an existing one to be able to invoke its methods using this instance.

{% callout type="note" title="Understanding datafiles" %}
You are recommended to learn more about [building datafiles](/docs/building-datafiles) before proceeding further.
{% /callout %}

Create a new instance (creates `FeaturevisorInstance` node):

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.createInstance({
    datafileUrl: "<featurevisor-datafile-url>",
  })
end sub
```

Or use existing instance:

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  ' define existingInstance

  f = FeaturevisorSDK()
  f.createInstance({}, existingInstance)
end sub
```

## Context

Contexts are [attribute](/docs/attributes) values that we pass to SDK for evaluating [features](/docs/features).

They are objects where keys are the attribute keys, and values are the attribute values.

```brightscirpt
context = {
  myAttributeKey: "myAttributeValue",
  anotherAttributeKey: "anotherAttributeValue",
}
```

Methods using the context (attributes) described above:

- `f.isEnabled(featureKey as String, context = {} as Object) as Boolean`
- `f.getVariation(feature as Dynamic, context = {} as Object) as Dynamic`
- `f.getVariable(feature as Dynamic, variableKey as String, context = {} as Object) as Object`
- `f.getVariableBoolean(feature as Dynamic, variableKey as String, context = {} as Object) as Boolean`
- `f.getVariableString(feature as Dynamic, variableKey as String, context = {} as Object) as Dynamic`
- `f.getVariableInteger(feature as Dynamic, variableKey as String, context = {} as Object) as Integer`
- `f.getVariableDouble(feature as Dynamic, variableKey as String, context = {} as Object) as Float`
- `f.getVariableArray(feature as Dynamic, variableKey as String, context = {} as Object) as Object`
- `f.getVariableObject(feature as Dynamic, variableKey as String, context = {} as Object) as Object`
- `f.getVariableJSON(feature as Dynamic, variableKey as String, context = {} as Object) as Dynamic`

## Checking if enabled

Once the SDK is initialized, you can check if a feature is enabled or not:

```brightscript
function isMyFeatureEnabled() as Boolean
  ' m.f is a FeaturevisorSDK with an initialized FeaturevisorInstance

  featureKey = "my_feature"
  context = {
    userId: "123",
    country: "nl",
  }

  return m.f.isEnabled(featureKey, context)
end function
```

## Getting variations

If your feature has any [variations](/docs/features/#variations) defined, you can get evaluate them as follows:

```brightscript
function getMyFeatureVariation() as Dynamic
  ' m.f is a FeaturevisorSDK with an initialized FeaturevisorInstance

  featureKey = "my_feature"
  context = {
    userId: "123",
    country: "nl",
  }

  return m.f.getVariation(featureKey, context)
end function
```

## Getting variables

Your features may also include [variables](/docs/features/#variables):

```brightscript
function getBgColorValue() as Dynamic
  ' m.f is a FeaturevisorSDK with an initialized FeaturevisorInstance

  featureKey = "my_feature"
  variableKey = "bgColor"
  context = {
    userId: "123",
    country: "nl",
  }

  return m.f.getVariable(featureKey, variableKey, context)
end function
```

## Type specific methods

Next to generic `f.getVariable(feature as Dynamic, variableKey as String, context = {} as Object) as Object` methods, there are also type specific methods available for convenience:

### `boolean`

```brightscript
f.getVariableBoolean(feature as Dynamic, variableKey as String, context = {} as Object) as Boolean
```

### `string`

```brightscript
f.getVariableString(feature as Dynamic, variableKey as String, context = {} as Object) as Dynamic
```

### `integer`

```brightscript
f.getVariableInteger(feature as Dynamic, variableKey as String, context = {} as Object) as Integer
```

### `double`

```brightscript
f.getVariableDouble(feature as Dynamic, variableKey as String, context = {} as Object) as Float
```

### `array`

```brightscript
f.getVariableArray(feature as Dynamic, variableKey as String, context = {} as Object) as Object
```

### `object`

```brightscript
f.getVariableObject(feature as Dynamic, variableKey as String, context = {} as Object) as Object
```

### `json`

```brightscript
f.getVariableJSON(feature as Dynamic, variableKey as String, context = {} as Object) as Dynamic
```

## Observe initialization

**Remember that if defined with `f.onReady` method, it should be called before `createInstance`**

By the `f.onReady(func as Function, context = Invalid as Object)`

```brightscript
' @import /components/libs/featurevisor/Featurevisor.facade.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.onReady(sub ()
    ' instance has been initialized and it is ready
  end sub) ' context can be added as an optional second argument
end sub
```

By the `f.createInstance(options as Object)` options:

```brightscript
' @import /components/libs/featurevisor/Featurevisor.facade.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.createInstance({
    onReady: {
      callback: sub ()
        ' instance has been initialized and it is ready
      end sub,
      context: {}, ' optional context for the callback
    },
  })
end sub
```

## Activation

Activation is useful when you want to track what features and their variations are exposed to your users.

It works the same as `f.getVariation()` method, but it will also bubble an event up that you can listen to.

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.onActivation(sub (data as Object)
    ' feature has been activated
  end sub) ' context can be added as an optional second argument
end sub
```

or

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.createInstance({
    onActivation: {
      callback: sub (data as Object)
        ' feature has been activated
      end sub,
      context: {}, ' optional context for the callback
    },
  })
end sub
```

`data` Object fields:

- `captureContext` - attributes that you want to capture, marked as `capture: true` in Attribute YAMLs
- `feature` - activated feature
- `context` - all the attributes used for evaluating
- `variationValue` - variation of the activated feature

## Initial features

You may want to initialize your SDK with a set of features before SDK has successfully fetched the datafile (if using `datafileUrl` option).

This helps in cases when you fail to fetch the datafile, but you still wish your SDK instance to continue serving a set of sensible default values. And as soon as the datafile is fetched successfully, the SDK will start serving values from there.

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.createInstance({
    ' ...
    initialFeatures: {
      myFeatureKey: {
        enabled: true,

        ' optional
        variation: "treatment",
        variables: {
          myVariableKey: "my-variable-value",
        },
      },
    },
  })
end sub
```

## Stickiness

Featurevisor relies on consistent bucketing making sure the same user always sees the same variation in a deterministic way. You can learn more about it in [Bucketing](/docs/bucketing) section.

But there are times when your targeting conditions (segments) can change and this may lead to some users being re-bucketed into a different variation. This is where stickiness becomes important.

If you have already identified your user in your application, and know what features should be exposed to them in what variations, you can initialize the SDK with a set of sticky features:

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.createInstance({
    ' ...
    stickyFeatures: {
      myFeatureKey: {
        enabled: true,

        ' optional
        variation: "treatment",
        variables: {
          myVariableKey: "my-variable-value",
        },
      },
    },
  })
end sub
```

Once initialized with sticky features, the SDK will look for values there first before evaluating the targeting conditions and going through the bucketing process.

You can also set sticky features after the SDK is initialized:

```brightscript
f.setStickyFeatures({
  myFeatureKey: {
    enabled: true,
    variation: "treatment",
    variables: {},
  },
  anotherFeatureKey: {
    enabled: false,
  }
})
```

This will be handy when you want to:

- update sticky features in the SDK without re-initializing it (or restarting the app), and
- handle evaluation of features for multiple users from the same instance of the SDK (e.g. in a server dealing with incoming requests from multiple users)

## Intercepting context

You can intercept context before they are used for evaluation:

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  defaultContext = {
    platform: "roku",
    locale: "en_US",
    country: "US",
    timezone: "America/New_York",
  }
  f = FeaturevisorSDK()
  f.createInstance({
    configureAndInterceptStaticContext: defaultContext,
    interceptContext: function (context as Object) as Object
      joinedContext = {}
      joinedContext.append(m) ' defaultContext
      joinedContext.append(context)

      return joinedContext
    end function,
  })
end sub
```

This is useful when you wish to add a default set of attributes as context for all your evaluations, giving you the convenience of not having to pass them in every time.

## Refreshing datafile

Refreshing the datafile is convenient when you want to update the datafile in runtime, for example when you want to update the feature variations and variables config without having to restart your application.

It is only possible to refresh datafile in Featurevisor if you are using the `datafileUrl` option when creating your SDK instance.

### Manual refresh

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  m.f = FeaturevisorSDK()
  m.f.createInstance({
    datafileUrl: "<featurevisor-datafile-url>",
  })
end sub

sub refresh()
  m.f.refresh()
end sub
```

### Refresh by interval

If you want to refresh your datafile every X number of seconds, you can pass the `refreshInterval` option when creating your SDK instance:

```brightscript
' @import /components/libs/featurevisor/FeaturevisorSDK.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.createInstance({
    datafileUrl: "<featurevisor-datafile-url>",
    refreshInterval: 60 * 5, ' every 5 minutes
  })
end sub
```

You can stop the interval by calling:

```brightscript
f.stopRefreshing()
```

If you want to resume refreshing:

```brightscript
f.startRefreshing()
```

### Listening for updates

Every successful refresh will trigger the `onRefresh()` option:

```brightscript
' @import /components/libs/featurevisor/Featurevisor.facade.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.onRefresh(sub ()
    ' datafile has been refreshed
  end sub) ' context can be added as an optional second argument
end sub
```

or

```brightscript
' @import /components/libs/featurevisor/Featurevisor.facade.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.createInstance({
    onRefresh: {
      callback: sub ()
        ' datafile has been refreshed
      end sub,
      context: {}, ' optional context for the callback
    },
  })
end sub
```

Not every refresh is going to be of a new datafile version. If you want to know if datafile content has changed in any particular refresh, you can listen to `onUpdate` option:

```brightscript
' @import /components/libs/featurevisor/Featurevisor.facade.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.onUpdate(sub ()
    ' datafile has been updated (the revision has changed)
  end sub) ' context can be added as an optional second argument
end sub
```

or

```brightscript
' @import /components/libs/featurevisor/Featurevisor.facade.brs from @featurevisor/roku

sub init()
  f = FeaturevisorSDK()
  f.createInstance({
    onUpdate: {
      callback: sub ()
        ' datafile has been updated (the revision has changed)
      end sub,
      context: {}, ' optional context for the callback
    },
  })
end sub
```
