---
title: Quick start
nextjs:
  metadata:
    title: Quick start
    description: Quick start guide for Featurevisor
    openGraph:
      title: Quick start
      description: Quick start guide for Featurevisor
      images:
        - url: /img/og/docs-quick-start.png
---

## Prerequisites

- [Node.js](https://nodejs.org/en/) >= 20.0.0

## Initialize your project

Run the following command to initialize your project:

```{% title="Command" %}
$ mkdir my-featurevisor-project && cd my-featurevisor-project
$ npx @featurevisor/cli init
```

This is meant to be a completely separate repository from your application code. Learn more in [Projects](/docs/projects) page.

## Installation

Once your project has been initialized, install all the dependencies:

```{% title="Command" %}
$ npm install
```

## Configure your project

Featurevisor configuration is stored in `featurevisor.config.js` file, with minimum configuration looking like this:

```js {% path="featurevisor.config.js" %}
module.exports = {
  tags: [
    'all',
  ],
  environments: [
    'staging',
    'production'
  ],
};
```

Learn more in [Configuration](/docs/configuration).

By default, Featurevisor defines [attributes](/docs/attributes), [segments](/docs/segments), and [features](/docs/features) as YAML files. If you want JSON, TOML, or any other format, see [custom parsers](/docs/advanced/custom-parsers) guide.

## Create an attribute

Attributes are the building blocks of creating conditions.

We will start by creating an attribute called `userId`:

```yml {% path="attributes/userId.yml" %}
type: string
description: User ID
```

Learn more in [Attributes](/docs/attributes).

## Create a segment

Segments are reusable conditions that can be applied as rules in your features to target specific users or groups of users.

Let's create a new attribute called `country` first:

```yml {% path="attributes/country.yml" %}
type: string
description: Country
```

Now, let's create a segment called `germany`:

```yml {% path="segments/germany.yml" %}
description: Users from Germany
conditions:
  - attribute: country
    operator: equals
    value: de
```

Learn more in [Segments](/docs/segments).

## Create a feature

We have come to the most interesting part now.

We can create a new `showBanner` feature, that controls showing a banner on our website:

```yml {% path="features/showBanner.yml" %}
description: Show banner
tags:
  - all

# this makes sure the same User ID consistently gets the same experience
bucketBy: userId

rules:
  staging:
    # in staging, we want to show the banner to everyone
    - key: everyone
      segments: '*'
      percentage: 100

  production:
    # in production, we want to test the feature in Germany first, and
    # it will be enabled for 100% of the traffic
    - key: de
      segments: germany
      percentage: 100

    - key: everyone
      segments: '*' # everyone
      percentage: 0 # disabled for everyone else
```

Learn more in [Features](/docs/features).

## Linting

We can lint the content of all our files to make sure they are all valid:

```{% title="Command" %}
$ npx featurevisor lint
```

Learn more in [Linting](/docs/linting).

## Build datafiles

Datafiles are static JSON files that we expect our client-side applications to consume using the Featurevisor [SDKs](/docs/sdks/).

Now that we have all the definitions in place, we can build the project:

```{% title="Command" %}
$ npx featurevisor build
```

This will generate datafiles in the `datafiles` directory for each of your [tags](/docs/tags/) against each [environment](/docs/environments/) as defined in your [`featurevisor.config.js`](/docs/configuration/) file.

With our example, we will have the following datafiles generated:

```
datafiles/
├── staging/
│   └── featurevisor-tag-all.json
└── production/
  └── featurevisor-tag-all.json
```

Learn more in [Building datafiles](/docs/building-datafiles).

## Deploy datafiles

This is the part where you deploy the datafiles to your CDN or any other static file hosting service.

Once done, the URLs of the datafiles may look like `https://cdn.yoursite.com/production/featurevisor-tag-all.json`.

Learn more in [Deployment](/docs/deployment).

## Consume datafiles using the SDK

Now that we have the datafiles deployed, we can consume them using the Featurevisor [SDK](/docs/sdks/).

### Install SDK

In your application, install the SDK first:

```{% title="Command" %}
$ npm install --save @featurevisor/sdk
```

Featurevisor JavaScript SDK is compatible with both Node.js and browser environments.

### Initialize SDK

You can initialize the SDK as follows:

```js {% path="your-app/index.js" %}
import { createInstance } from '@featurevisor/sdk'

const datafileUrl =
  'https://cdn.yoursite.com/production/featurevisor-tag-all.json'

const datafileContent = await fetch(datafileUrl)
  .then((res) => res.json())

const f = createInstance({
  datafile: datafileContent,
})
```

### Set context

Let the SDK know against what context the values should be evaluated:

```js
const context = {
  userId: '123',
  country: 'de',
}

f.setContext(context)
```

### Evaluate values

Once the SDK is initialized, you can evaluate your features:

```js
// flag status: true or false
const isBannerEnabled = f.isEnabled('showBanner')
```

Featurevisor SDK will take care of evaluating the right value(s) for you synchronously against the provided `userId` and `country` attributes in the context.

### Variables & Variations

Above example only makes use of the feature's boolean flag status only, but features may also contain [variables](/docs/features/#variables) and [variations](/docs/features/#variations), which can be evaluated with the SDK instance:

```js
// variation: `control`, `treatment`, or more
const bannerVariation = f.getVariation('showBanner', context)

// variables
const variableKey = 'myVariableKey'
const myVariable = f.getVariable('showBanner', variableKey, context)
```

Find more examples of SDK usage [here](/docs/sdks/javascript/).
