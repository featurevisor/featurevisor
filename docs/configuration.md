---
title: Configuration
description: Configure your Featurevisor project
---

Every Featurevisor project expects a `featurevisor.config.js` file at the root of the project, next to `package.json`. {% .lead %}

## `featurevisor.config.js`

Minimum configuration:

```js
// featurevisor.config.js
module.exports = {
  tags: ["all"],
  environments: ["staging", "production"],
};
```

As your tags and environments grow, you can keep adding them to your configuration file.

## Additional configuration

### `attributesDirectoryPath`

Path to the directory containing your [attributes](/docs/attributes/).

Defaults to `<rootDir>/attributes`.

### `segmentsDirectoryPath`

Path to the directory containing your [segments](/docs/segments/).

Defaults to `<rootDir>/segments`.

### `featuresDirectoryPath`

Path to the directory containing your [features](/docs/features/).

Defaults to `<rootDir>/features`.

### `groupsDirectoryPath`

Path to the directory containing your [groups](/docs/groups/).

Defaults to `<rootDir>/groups`.

### `testsDirectoryPath`

Path to the directory containing your [tests](/docs/testing/).

Defaults to `<rootDir>/tests`.

### `outputDirectoryPath`

Path to the directory for your generated [datafiles](/docs/building-datafiles/).

Defaults to `<rootDir>/dist`.

### `stateDirectoryPath`

Path to the directory containing your state.

Defaults to `<rootDir>/.featurevisor`.

Read more in [State files](/docs/state-files).

### `defaultBucketBy`

Default value for the `bucketBy` property in your project. Defaults to `userId`.

### `prettyState`

Set to `true` or `false` to enable or disable pretty-printing of state files.

Defaults to `false`.

### `prettyDatafile`

Set to `true` or `false` to enable or disable pretty-printing of datafiles.

Defaults to `false`.

### `stringify`

By default, Featurevisor will stringify conditions and segments in generated datafiles so that they are parsed only when needed by the SDKs. This optimization technique works well when datafiles are too large in client-side devices (think browsers) and you are only dealing with one user in the runtime.

This kind of optimization though can bring opposite results if you are using the SDKs in server-side (think Node.js) serving many different users.

To disable this stringification, you can set it to `false`.

### `parser`

By default, Featurevisor expects YAML for all definitions. You can change this to JSON by setting `parser: "json"`.

### `enforceCatchAllRule`

When set to `true`, linting will make sure all features have a catch-all rule with `segment: "*"` as the last rule in all environments.

### `maxVariableStringLength`

Maximum length of a string variable in features. Defaults to no limit.

### `maxVariableArrayStringifiedLength`

Maximum length of a stringified array variable in features. Defaults to no limit.

### `maxVariableObjectStringifiedLength`

Maximum length of a stringified object variable in features. Defaults to no limit.

### `maxVariableJSONStringifiedLength`

Maximum length of a JSON stringified variable in features. Defaults to no limit.
