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

Let's create a feature called `darkMode`, and we wish to roll it out gradually in Germany first and then rest of the world.

```yml
# features/darkMode.yml
description: Dark mode
tags:
  - all

# this makes sure the same User ID consistently gets the same variation
bucketBy: userId

defaultVariation: false

# two variations: true or false
variations:
  - type: boolean
    value: false
    weight: 50 # out of a total of 100
  - type: boolean
    value: true
    weight: 50 # half the traffic will get true, and half will get false

environments:
  staging:
    rules:
      - key: "1"
        segments: "*" # in staging, we want to test the feature for everyone
        percentage: 100
  production:
    rules:
      - key: "1"
        segments: "germany" # in production, we want to test the feature for Germany first
        percentage: 50 # 50% of the traffic in Germany will be exposed to the feature
```

Given our variations are a 50-50 split, and our production rule's rollout in Germany is 50%, it means 25% (50% variation weight of 50% rollout rule) of the traffic in Germany will get `true` and the rest will get `false`.

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
const darkModeEnabled = sdk.getVariation("darkMode". {
  userId: "123",
  country: "de",
});
```

Featurevisor SDK will take care of computing the right variation for you against the given `userId` and `country` attributes.

Find more examples of SDK usage [here](/docs/sdks).
