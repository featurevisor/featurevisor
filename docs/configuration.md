---
title: Configuration
description: Configure your Featurevisor project
---

Every Featurevisor project expects a `featurevisor.config.js` file at the root of the project, next to `package.json`. {% .lead %}

## `featurevisor.config.js`

Minimum configuration:

```js
module.exports = {
  tags: ["all"],
  environments: ["staging", "production"],
}
```

As your tags and environments grow, you can keep adding them to your configuration file.

## Additional configuration

### `attributesDirectoryPath`

Path to the directory containing your attributes.

Defaults to `<rootDir>/attributes`.

### `segmentsDirectoryPath`

Path to the directory containing your segments.

Defaults to `<rootDir>/segments`.

### `featuresDirectoryPath`

Path to the directory containing your features.

Defaults to `<rootDir>/features`.

### `testsDirectoryPath`

Path to the directory containing your tests.

Defaults to `<rootDir>/tests`.

### `stateDirectoryPath`

Path to the directory containing your state.

Defaults to `<rootDir>/.featurevisor`.

Read more in [State files](/docs/state-files).

### `defaultBucketBy`

Default value for the `bucketBy` property in your project. Defaults to `userId`.
