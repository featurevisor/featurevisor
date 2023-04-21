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

This is maent be a completely separate repository from your application code. The idea is to be able to decouple your application deployments from releasing your features.

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

## Create a feature

We have come to the most interesting part now.

### Boolean flags

We can create a new `showBanner` feature, that controls a banner on our website:

```yml
# features/showBanner.yml
description: Show banner
tags:
  - all

# this makes sure the same User ID consistently gets the same variation
bucketBy: userId

defaultVariation: false

# boolean flags have only two variations: true and false
variations:
  - type: boolean
    value: true
    weight: 100 # out of a total of 100

  # weight is 0 because it's boolean, and
  # we can control the rollout percentage from environment rules below
  - type: boolean
    value: false
    weight: 0

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
```

### A/B test with variations

Unlike boolean flags, A/B tests can have more than 2 variations, and they are of `string` type.

Let's create a feature called `darkMode` which has 3 variations, and we wish to roll it out gradually in Germany first and then rest of the world.

```yml
# features/darkMode.yml
description: Dark mode
tags:
  - all

bucketBy: userId

defaultVariation: light

# three variations: light, dimmed, and dark.
# sum of all weights must be 100
variations:
  - type: string
    value: light
    weight: 33.34

  - type: string
    value: dimmed
    weight: 33.33

  - type: string
    value: dark
    weight: 33.33

environments:
  staging:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
  production:
    rules:
      - key: "1"
        segments:
          - "germany"
        percentage: 100

      - key: "2"
        segments: "*" # everyone
        percentage: 0 # disabled for everyone else
```

## Linting

We can lint the content of all our YAML files to make sure it's all valid:

```
$ featurevisor lint
```

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

## Deploy datafiles

This is the part where you deploy the datafiles to your CDN or any other static file hosting service.

Once done, the URLs of the datafiles may look like `https://cdn.yoursite.com/production/datafile-tag-all.json`.

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

const datafileURL =
  "https://cdn.yoursite.com/production/datafile-tag-all.json";
const datafileContent = await fetch(datafileURL).then((res) => res.json());

const sdk = createInstance({
  datafile: datafileContent,
});
```

### Asynchronous

If you want to delegate the responsibility of fetching the datafile to the SDK, you can initialize it as follows:

```js
// your-app/index.js
import { createInstance } from "@featurevisor/sdk";

const datafileURL =
  "https://cdn.yoursite.com/production/datafile-tag-all.json";

const sdk = createInstance({
  datafileUrl: datafileUrl,
  onReady: function () {
    // datafile has been fetched successfully,
    // and you can start using the SDK
  }
});
```

### Usage

Once the SDK is initialized, you can get variations of your features as follows:

```js
const showBanner = sdk.getVariation("showBanner". {
  userId: "123",
  country: "de",
});
```

Featurevisor SDK will take care of computing the right variation for you against the given `userId` and `country` attributes.

Find more examples of SDK usage [here](/docs/sdks).
