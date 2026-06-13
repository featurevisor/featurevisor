---
title: Configuration
nextjs:
  metadata:
    title: Configuration
    description: Configure your Featurevisor project
    openGraph:
      title: Configuration
      description: Configure your Featurevisor project
      images:
        - url: /img/og/docs.png
---

Every Featurevisor project expects a `featurevisor.config.js` file at the root of the project, next to `package.json`. {% .lead %}

## `featurevisor.config.js`

Minimum configuration:

```js {% path="featurevisor.config.js" %}
module.exports = {
  tags: [
    'web',
    'mobile',
  ],
}
```

As your [tags](/docs/tags) grow, you can keep adding them to your configuration file. If your project needs [environments](/docs/environments), configure them explicitly.

## Params

### `tags`

An array of [tags](/docs/tags) that can be used in your [features](/docs/features/). Tags are used for building smaller [datafiles](/docs/building-datafiles) containing only the features that you need for your application(s).

```js {% path="featurevisor.config.js" %}
module.exports = {
  tags: [
    'web',
    'ios',
    'android',
    'all'
  ],
}
```

### `environments`

An optional array of [environments](/docs/environments) that can be used in your [features](/docs/features/).

By default, Featurevisor has no environments. This means feature rules are defined directly:

```yml {% path="features/my_feature.yml" %}
rules:
  - key: everyone
    segments: '*'
    percentage: 100
```

If your project needs environments, define them as an array of strings:

```js {% path="featurevisor.config.js" %}
module.exports = {
  environments: [
    'staging',
    'production'
  ],
}
```

Read more in [Environments](/docs/environments) page.

### `scopes`

Scopes allow creating smaller and more optimized [datafiles](/docs/building-datafiles).

Read more in [Scopes](/docs/scopes) page.

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

### `datafilesDirectoryPath`

Path to the directory for your generated [datafiles](/docs/building-datafiles/).

Defaults to `<rootDir>/dist`.

### `datafileNamePattern`

Defaults to `featurevisor-%s.json`.

### `revisionFileName`

Defaults to `REVISION`.

Name of the file that will be used to store the [revision](/docs/building-datafiles/) number of your project.

### `stateDirectoryPath`

Path to the directory containing your state.

Defaults to `<rootDir>/.featurevisor`.

Read more in [State files](/docs/state-files).

### `defaultBucketBy`

Default value for the `bucketBy` property in your project. Defaults to `userId`.

### `prettyState`

Set to `true` or `false` to enable or disable pretty-printing of state files.

Defaults to `true`.

### `prettyDatafile`

Set to `true` or `false` to enable or disable pretty-printing of datafiles.

Defaults to `false`.

### `stringify`

By default, Featurevisor will stringify conditions and segments in generated datafiles so that they are parsed only when needed by the SDKs. This optimization technique works well when datafiles are too large in client-side devices (think browsers) and you are only dealing with one user in the runtime.

This kind of optimization though can bring opposite results if you are using the SDKs in server-side (think Node.js) serving many different users.

To disable this stringification, you can set it to `false`.

### `parser`

By default, Featurevisor expects YAML for all definitions. You can change this to JSON by setting `parser: "json"`.

See [custom parsers](/docs/advanced/custom-parsers) for more information.

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
