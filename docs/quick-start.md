---
title: Quick start
description: Quick start guide for Featurevisor
---

## Prerequisites

- [Node.js](https://nodejs.org/en/) >= 16.0.0

## Installation

Easiest way to get started is by using the Featurevisor CLI.

```
$ npm install -g @featurevisor/cli
```

If you want to avoid global installation, you can use `npx` instead:

```
$ npx @featurevisor/cli <command>
```

## Initialize your project

This is meant to be a completely separate repository from your application code.

The idea is to be able to decouple your application deployments from releasing your features. Therefore, it stays as a separate repository.

Run the following command to initialize your project:

```
$ mkdir my-project && cd my-project
$ featurevisor init
```

If you want to initialize a specific example:

```
$ featurevisor init --example <name>
```

You can find all available examples [here](/docs/examples).

## Dependencies

We start by installing all the necessary local dependencies:

```
$ npm install
```

## Configure your project

Featurevisor configuration is stored in `featurevisor.config.js` file, with minimum configuration looking like this:

```js
// featurevisor.config.js
module.exports = {
  tags: ["all"],
  environments: ["staging", "production"],
};
```

Learn more in [Configuration](/docs/configuration).

## Create an attribute

Attributes are the building blocks of creating segments.

We will start by creating an attribute called `userId`:

```yml
# attributes/userId.yml
type: string
description: User ID
```

Learn more in [Attributes](/docs/attributes).

## Create a segment

Segments are groups of users that you can target, and they are made up of conditions against various attributes.

Let's create a new attribute called `country` first:

```yml
# attributes/country.yml
type: string
description: Country
```

Now, let's create a segment called `germany`:

```yml
# segments/germany.yml
description: Users from Germany
conditions:
  - attribute: country
    operator: equals
    value: de
```

Learn more in [Segments](/docs/segments).

## Create a feature

We have come to the most interesting part now.

We can create a new `showBanner` feature, that controls a banner on our website:

```yml
# features/showBanner.yml
description: Show banner
tags:
  - all

# this makes sure the same User ID consistently gets the same variation
bucketBy: userId

# optionally add variations for running a/b tests
variations:
  - value: control
    weight: 50 # out of a total of 100

  - value: treatment
    weight: 50 # total sum of weights has to be 100

environments:
  staging:
    rules:
      - key: "1"
        segments: "*" # in staging, we want to show the banner to everyone
        percentage: 100
  production:
    rules:
      # in production, we want to test the feature in Germany first, and
      # it will be `true` variation for 50% of the traffic
      - key: "1"
        segments:
          - "germany"
        percentage: 50

      - key: "2"
        segments: "*" # everyone
        percentage: 0 # disabled for everyone else
```

## Linting

We can lint the content of all our YAML files to make sure it's all valid:

```
$ featurevisor lint
```

Learn more in [Linting YAMLs](/docs/linting-yamls).

## Build datafiles

Datafiles are JSON files that we expect our client-side applications to consume using the Featurevisor SDK.

Now that we have all the configuration in place, we can build the project:

```
$ featurevisor build
```

This will generate datafiles in the `dist` directory for each of your tags against each environment as defined in your `featurevisor.config.js` file.

With our example, we will have the following datafiles generated:

- `dist/staging/datafile-tag-all.json`
- `dist/production/datafile-tag-all.json`

Learn more in [Building datafiles](/docs/building-datafiles).

## Deploy datafiles

This is the part where you deploy the datafiles to your CDN or any other static file hosting service.

Once done, the URLs of the datafiles may look like `https://cdn.yoursite.com/production/datafile-tag-all.json`.

Learn more in [Deployment](/docs/deployment).

## Consume datafiles using the SDK

Now that we have the datafiles deployed, we can consume them using the Featurevisor SDK.

In your application, install the SDK first:

```
$ npm install --save @featurevisor/sdk
```

Featurevisor SDK is compatible with both Node.js and browser environments.

### Synchronous

If you already have the datafile content available, you can initialize the SDK as follows:

```js
// your-app/index.js
import { createInstance } from "@featurevisor/sdk";

const datafileUrl =
  "https://cdn.yoursite.com/production/datafile-tag-all.json";
const datafileContent = await fetch(datafileUrl).then((res) => res.json());

const f = createInstance({
  datafile: datafileContent,
});
```

### Asynchronous

If you want to delegate the responsibility of fetching the datafile to the SDK, you can initialize it as follows:

```js
// your-app/index.js
import { createInstance } from "@featurevisor/sdk";

const datafileUrl =
  "https://cdn.yoursite.com/production/datafile-tag-all.json";

const f = createInstance({
  datafileUrl,
  onReady: function () {
    // datafile has been fetched successfully,
    // and you can start using the SDK
  }
});
```

### Usage

Once the SDK is initialized, you can get variations of your features as follows:

```js
const featureKey = "showBanner";
const context = {
  userId: "123",
  country: "de",
};

// true or false
const isBannerEnabled = f.isEnabled(featureKey, context);

 // `control` or `treatment`
const bannerVariation = f.getVariation(featureKey, context);
```

Featurevisor SDK will take care of computing the right variation for you against the given `userId` and `country` attributes as context.

Find more examples of SDK usage [here](/docs/sdks).
