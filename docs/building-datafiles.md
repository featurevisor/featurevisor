---
title: Building datafiles
description: Build your Featurevisor project datafiles
---

Datafiles are JSON files that are created against combinations of tags and environments. They are used to evaluate features in your application via Featurevisor SDKs. {% .lead %}

## Usage

```
$ featurevisor build
```

## Output

The build output can be found in the `dist` directory.

If your `featurevisor.config.js` file looks like this:

```js
// featurevisor.config.js
module.exports = {
  tags: ["all"],
  environments: ["staging", "production"],
}
```

Then the contents of your `dist` directory will look like this:

```
$ tree dist
.
├── production
│   └── datafile-tag-all.json
└── staging
    └── datafile-tag-all.json

2 directories, 2 files
```

Next to datafiles, the build process will also generate some additional JSON files that we can learn about in [State files](./docs/state-files).
