---
title: Java SDK
nextjs:
  metadata:
    title: Java SDK
    description: Learn how to use Featurevisor Java SDK
    openGraph:
      title: Java SDK
      description: Learn how to use Featurevisor Java SDK
      images:
        - url: /img/og/docs-sdks-java.png
---

Featurevisor's Java SDK is a library for evaluating feature flags, experiment variations, and variables in your Java applications. {% .lead %}

## Installation

In your Java application, update `pom.xml` to add the following:

### Repository

For finding GitHub Package (public package):

```xml
<repositories>
    <repository>
        <id>github</id>
        <name>GitHub Packages</name>
        <url>https://maven.pkg.github.com/featurevisor/featurevisor-java</url>
    </repository>
</repositories>
```

### Dependency

Add Featurevisor Java SDK as a dependency with your desired version:

```xml
<dependencies>
    <dependency>
        <groupId>com.featurevisor</groupId>
        <artifactId>featurevisor-java</artifactId>
        <version>0.0.6</version>
    </dependency>
</dependencies>
```

Find latest version here: [https://github.com/featurevisor/featurevisor-java/packages](https://github.com/featurevisor/featurevisor-java/packages)

### Authentication

To authenticate with GitHub Packages, in your `~/.m2/settings.xml` file, add the following:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0
                              http://maven.apache.org/xsd/settings-1.0.0.xsd">

  <servers>
    <server>
      <id>github</id>
      <username>YOUR_GITHUB_USERNAME</username>
      <password>YOUR_GITHUB_TOKEN</password>
    </server>
  </servers>

</settings>
```

You can generate a new GitHub token with `read:packages` scope here: [https://github.com/settings/tokens](https://github.com/settings/tokens)

See example application here: [https://github.com/featurevisor/featurevisor-example-java](https://github.com/featurevisor/featurevisor-example-java)

## Initialization

The SDK can be initialized by passing [datafile](https://featurevisor.com/docs/building-datafiles/) content directly:

```java
import com.featurevisor.sdk.Featurevisor;

// Load datafile content
String datafileUrl = "https://cdn.yoursite.com/datafile.json";
String datafileContent = "..." // load your datafile content

// Create SDK instance
Featurevisor f = Featurevisor.createInstance(datafileContent);
```

or by constructing a `Featurevisor.Options` object:

```java
Featurevisor f = Featurevisor.createInstance(new Featurevisor.Options()
    .datafile(datafileContent)
);
```

We will learn about several different options in the next sections.

## Evaluation types

We can evaluate 3 types of values against a particular [feature](https://featurevisor.com/docs/features/):

- [**Flag**](#check-if-enabled) (`boolean`): whether the feature is enabled or not
- [**Variation**](#getting-variation) (`Object`): the variation of the feature (if any)
- [**Variables**](#getting-variables): variable values of the feature (if any)

These evaluations are run against the provided context.

## Context

Contexts are [attribute](https://featurevisor.com/docs/attributes) values that we pass to SDK for evaluating [features](https://featurevisor.com/docs/features) against.

Think of the conditions that you define in your [segments](https://featurevisor.com/docs/segments/), which are used in your feature's [rules](https://featurevisor.com/docs/features/#rules).

They are plain maps:

```java
Map<String, Object> context = new HashMap<>();
context.put("userId", "123");
context.put("country", "nl");
// ...other attributes
```

Context can be passed to SDK instance in various different ways, depending on your needs:

### Setting initial context

You can set context at the time of initialization:

```java
Map<String, Object> initialContext = new HashMap<>();
initialContext.put("deviceId", "123");
initialContext.put("country", "nl");

Featurevisor f = Featurevisor.createInstance(new Featurevisor.Options()
    .datafile(datafileContent)
    .context(initialContext));
```

This is useful for values that don't change too frequently and available at the time of application startup.

### Setting after initialization

You can also set more context after the SDK has been initialized:

```java
Map<String, Object> additionalContext = new HashMap<>();
additionalContext.put("userId", "123");
additionalContext.put("country", "nl");

f.setContext(additionalContext);
```

This will merge the new context with the existing one (if already set).

### Replacing existing context

If you wish to fully replace the existing context, you can pass `true` in second argument:

```java
Map<String, Object> newContext = new HashMap<>();
newContext.put("deviceId", "123");
newContext.put("userId", "234");
newContext.put("country", "nl");
newContext.put("browser", "chrome");

f.setContext(newContext, true); // replace existing context
```

### Manually passing context

You can optionally pass additional context manually for each and every evaluation separately, without needing to set it to the SDK instance affecting all evaluations:

```java
Map<String, Object> context = new HashMap<>();
context.put("userId", "123");
context.put("country", "nl");

boolean isEnabled = f.isEnabled("my_feature", context);
String variation = f.getVariation("my_feature", context);
String variableValue = f.getVariableString("my_feature", "my_variable", context);
```

When manually passing context, it will merge with existing context set to the SDK instance before evaluating the specific value.

Further details for each evaluation types are described below.

## Check if enabled

Once the SDK is initialized, you can check if a feature is enabled or not:

```java
String featureKey = "my_feature";

boolean isEnabled = f.isEnabled(featureKey);

if (isEnabled) {
    // do something
}
```

You can also pass additional context per evaluation:

```java
Map<String, Object> additionalContext = new HashMap<>();
// ...additional context

boolean isEnabled = f.isEnabled(featureKey, additionalContext);
```

## Getting variation

If your feature has any [variations](https://featurevisor.com/docs/features/#variations) defined, you can evaluate them as follows:

```java
String featureKey = "my_feature";

String variation = f.getVariation(featureKey);

if ("treatment".equals(variation)) {
    // do something for treatment variation
} else {
    // handle default/control variation
}
```

Additional context per evaluation can also be passed:

```java
String variation = f.getVariation(featureKey, additionalContext);
```

## Getting variables

Your features may also include [variables](https://featurevisor.com/docs/features/#variables), which can be evaluated as follows:

```java
String variableKey = "bgColor";

String bgColorValue = f.getVariableString(featureKey, variableKey);
```

Additional context per evaluation can also be passed:

```java
String bgColorValue = f.getVariableString(featureKey, variableKey, additionalContext);
```

### Type specific methods

Next to generic `getVariable()` methods, there are also type specific methods available for convenience:

```java
f.getVariableBoolean(featureKey, variableKey, context);
f.getVariableString(featureKey, variableKey, context);
f.getVariableInteger(featureKey, variableKey, context);
f.getVariableDouble(featureKey, variableKey, context);
f.getVariableArray(featureKey, variableKey, context);

f.<Map<String, Object>>getVariableObject(featureKey, variableKey, context);
f.<MyCustomClass>getVariableObject(featureKey, variableKey, context);

f.<Map<String, Object>>getVariableJSON(featureKey, variableKey, context);
f.<MyCustomClass>getVariableJSON(featureKey, variableKey, context);
```

## Getting all evaluations

You can get evaluations of all features available in the SDK instance:

```java
import com.featurevisor.types.EvaluatedFeatures;
import com.featurevisor.types.EvaluatedFeature;

EvaluatedFeatures allEvaluations = f.getAllEvaluations(context);

// Access the evaluations map
Map<String, EvaluatedFeature> evaluations = allEvaluations.getValue();

System.out.println(evaluations);
// {
//   "myFeature": {
//     "enabled": true,
//     "variation": "control",
//     "variables": {
//       "myVariableKey": "myVariableValue"
//     }
//   },
//
//   "anotherFeature": {
//     "enabled": true,
//     "variation": "treatment"
//   }
// }
```

This is handy especially when you want to pass all evaluations from a backend application to the frontend.

## Sticky

For the lifecycle of the SDK instance in your application, you can set some features with sticky values, meaning that they will not be evaluated against the fetched [datafile](https://featurevisor.com/docs/building-datafiles/):

### Initialize with sticky

```java
Map<String, Object> stickyFeatures = new HashMap<>();

Map<String, Object> myFeatureSticky = new HashMap<>();
myFeatureSticky.put("enabled", true);
myFeatureSticky.put("variation", "treatment");

Map<String, Object> myVariables = new HashMap<>();
myVariables.put("myVariableKey", "myVariableValue");
myFeatureSticky.put("variables", myVariables);

stickyFeatures.put("myFeatureKey", myFeatureSticky);

Map<String, Object> anotherFeatureSticky = new HashMap<>();
anotherFeatureSticky.put("enabled", false);
stickyFeatures.put("anotherFeatureKey", anotherFeatureSticky);

Featurevisor f = Featurevisor.createInstance(new Featurevisor.Options()
    .datafile(datafile)
    .sticky(stickyFeatures));
```

Once initialized with sticky features, the SDK will look for values there first before evaluating the targeting conditions and going through the bucketing process.

### Set sticky afterwards

You can also set sticky features after the SDK is initialized:

```java
Map<String, Object> stickyFeatures = new HashMap<>();
// ... build sticky features map

f.setSticky(stickyFeatures, true); // replace existing sticky features
```

## Setting datafile

You may also initialize the SDK without passing `datafile`, and set it later on:

```java
f.setDatafile(datafileContent);
```

### Updating datafile

You can set the datafile as many times as you want in your application, which will result in emitting a [`datafile_set`](#datafile_set) event that you can listen and react to accordingly.

The triggers for setting the datafile again can be:

- periodic updates based on an interval (like every 5 minutes), or
- reacting to:
  - a specific event in your application (like a user action), or
  - an event served via websocket or server-sent events (SSE)

### Interval-based update

Here's an example of using interval-based update:

```java
// Using ScheduledExecutorService for periodic updates
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
scheduler.scheduleAtFixedRate(() -> {
    // Fetch new datafile content
    String newDatafileContent = // ... fetch from your CDN
    DatafileContent newDatafile = DatafileContent.fromJson(newDatafileContent);

    // Update the SDK
    f.setDatafile(newDatafile);
}, 0, 5, TimeUnit.MINUTES);
```

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

```java
import com.featurevisor.sdk.Logger;

Featurevisor f = Featurevisor.createInstance(new Featurevisor.Options()
    .datafile(datafile)
    .logLevel(Logger.LogLevel.DEBUG));
```

You can also set log level from SDK instance afterwards:

```java
f.setLogLevel(Logger.LogLevel.DEBUG);
```

### Handler

You can also pass your own log handler, if you do not wish to print the logs to the console:

```java
// Create a custom logger with a custom handler
Logger customLogger = Logger.createLogger(new Logger.CreateLoggerOptions()
    .level(Logger.LogLevel.INFO)
    .handler((level, message, details) -> {
        // do something with the log
        System.out.println("[" + level + "] " + message);
    }));

Featurevisor f = Featurevisor.createInstance(new Featurevisor.Options()
    .datafile(datafile)
    .logger(customLogger));
```

Alternatively, you can create a custom logger directly:

```java
Logger customLogger = new Logger(Logger.LogLevel.INFO, (level, message, details) -> {
    // do something with the log
    System.out.println("[" + level + "] " + message);
});

Featurevisor f = Featurevisor.createInstance(new Featurevisor.Options()
    .datafile(datafile)
    .logger(customLogger));
```

Further log levels like `info` and `debug` will help you understand how the feature variations and variables are evaluated in the runtime against given context.

## Events

Featurevisor SDK implements a simple event emitter that allows you to listen to events that happen in the runtime.

You can listen to these events that can occur at various stages in your application:

### `datafile_set`

```java
Runnable unsubscribe = f.on("datafile_set", (event) -> {
    String revision = (String) event.get("revision"); // new revision
    String previousRevision = (String) event.get("previousRevision");
    Boolean revisionChanged = (Boolean) event.get("revisionChanged"); // true if revision has changed

    // list of feature keys that have new updates,
    // and you should re-evaluate them
    @SuppressWarnings("unchecked")
    List<String> features = (List<String>) event.get("features");

    // handle here
});

// stop listening to the event
unsubscribe.run();
```

The `features` array will contain keys of features that have either been:

- added, or
- updated, or
- removed

compared to the previous datafile content that existed in the SDK instance.

### `context_set`

```java
Runnable unsubscribe = f.on("context_set", (event) -> {
    Boolean replaced = (Boolean) event.get("replaced"); // true if context was replaced
    @SuppressWarnings("unchecked")
    Map<String, Object> context = (Map<String, Object>) event.get("context"); // the new context

    System.out.println("Context set");
});
```

### `sticky_set`

```java
Runnable unsubscribe = f.on("sticky_set", (event) -> {
    Boolean replaced = (Boolean) event.get("replaced"); // true if sticky features got replaced
    @SuppressWarnings("unchecked")
    List<String> features = (List<String>) event.get("features"); // list of all affected feature keys

    System.out.println("Sticky features set");
});
```

## Evaluation details

Besides logging with debug level enabled, you can also get more details about how the feature variations and variables are evaluated in the runtime against given context:

```java
// flag
Map<String, Object> evaluation = f.evaluateFlag(featureKey, context);

// variation
Map<String, Object> evaluation = f.evaluateVariation(featureKey, context);

// variable
Map<String, Object> evaluation = f.evaluateVariable(featureKey, variableKey, context);
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

```java
Map<String, Object> myCustomHook = new HashMap<>();
myCustomHook.put("name", "my-custom-hook");

// before evaluation
myCustomHook.put("before", (options) -> {
    String type = (String) options.get("type"); // "feature" | "variation" | "variable"
    String featureKey = (String) options.get("featureKey");
    String variableKey = (String) options.get("variableKey"); // if type is "variable"
    @SuppressWarnings("unchecked")
    Map<String, Object> context = (Map<String, Object>) options.get("context");

    // update context before evaluation
    context.put("someAdditionalAttribute", "value");
    options.put("context", context);

    return options;
});

// after evaluation
myCustomHook.put("after", (evaluation, options) -> {
    String reason = (String) evaluation.get("reason"); // "error" | "feature_not_found" | "variable_not_found" | ...

    if ("error".equals(reason)) {
        // log error
        return;
    }
});

// configure bucket key
myCustomHook.put("bucketKey", (options) -> {
    String featureKey = (String) options.get("featureKey");
    @SuppressWarnings("unchecked")
    Map<String, Object> context = (Map<String, Object>) options.get("context");
    String bucketBy = (String) options.get("bucketBy");
    String bucketKey = (String) options.get("bucketKey"); // default bucket key

    // return custom bucket key
    return bucketKey;
});

// configure bucket value (between 0 and 100,000)
myCustomHook.put("bucketValue", (options) -> {
    String featureKey = (String) options.get("featureKey");
    @SuppressWarnings("unchecked")
    Map<String, Object> context = (Map<String, Object>) options.get("context");
    String bucketKey = (String) options.get("bucketKey");
    Integer bucketValue = (Integer) options.get("bucketValue"); // default bucket value

    // return custom bucket value
    return bucketValue;
});
```

### Registering hooks

You can register hooks at the time of SDK initialization:

```java
List<Map<String, Object>> hooks = new ArrayList<>();
hooks.add(myCustomHook);

Featurevisor f = Featurevisor.createInstance(new Featurevisor.Options()
    .datafile(datafile)
    .hooks(hooks));
```

Or after initialization:

```java
Runnable removeHook = f.addHook(myCustomHook);

// removeHook.run();
```

## Child instance

When dealing with purely client-side applications, it is understandable that there is only one user involved, like in browser or mobile applications.

But when using Featurevisor SDK in server-side applications, where a single server instance can handle multiple user requests simultaneously, it is important to isolate the context for each request.

That's where child instances come in handy:

```java
Map<String, Object> childContext = new HashMap<>();
childContext.put("userId", "123");

ChildInstance childF = f.spawn(childContext);
```

Now you can pass the child instance where your individual request is being handled, and you can continue to evaluate features targeting that specific user alone:

```java
boolean isEnabled = childF.isEnabled("my_feature");
String variation = childF.getVariation("my_feature");
String variableValue = childF.getVariableString("my_feature", "my_variable");
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

```java
f.close();
```

## CLI usage

This package also provides a CLI tool for running your Featurevisor project's test specs and benchmarking against this Java SDK:

### Test

Learn more about testing [here](https://featurevisor.com/docs/testing/).

```bash
$ mvn exec:java -Dexec.mainClass="com.featurevisor.cli.CLI" -Dexec.args="test --projectDirectoryPath=/absolute/path/to/your/featurevisor/project"
```

Additional options that are available:

```bash
$ mvn exec:java -Dexec.mainClass="com.featurevisor.cli.CLI" -Dexec.args="test --projectDirectoryPath=/absolute/path/to/your/featurevisor/project --quiet --onlyFailures --keyPattern=myFeatureKey --assertionPattern=#1"
```

### Benchmark

Learn more about benchmarking [here](https://featurevisor.com/docs/cli/#benchmarking).

```bash
$ mvn exec:java -Dexec.mainClass="com.featurevisor.cli.CLI" -Dexec.args="benchmark --projectDirectoryPath=/absolute/path/to/your/featurevisor/project --environment=production --feature=myFeatureKey --context='{\"country\": \"nl\"}' --n=1000"
```

### Assess distribution

Learn more about assessing distribution [here](https://featurevisor.com/docs/cli/#assess-distribution).

```bash
$ mvn exec:java -Dexec.mainClass="com.featurevisor.cli.CLI" -Dexec.args="assess-distribution --projectDirectoryPath=/absolute/path/to/your/featurevisor/project --environment=production --feature=foo --variation --context='{\"country\": \"nl\"}' --populateUuid=userId --populateUuid=deviceId --n=1000"
```
