---
title: Projects
nextjs:
  metadata:
    title: Projects
    description: Learn how to create and manage Featurevisor projects
    openGraph:
      title: Projects
      description: Learn how to create and manage Featurevisor projects
      images:
        - url: /img/og/docs-projects.png
---

A Featurevisor project is intended to be used as a single standalone Git repository, separate from your application codebase. {% .lead %}

## Creating a project

The easiest way is to use the Featurevisor CLI using `npx` (Node.js).

Create a new project directory first:

```{% title="Command" %}
$ mkdir my-project
$ cd my-project
```

And inside the newly created directory, initialize a Featurevisor project:

```{% title="Command" %}
$ npx @featurevisor/cli init
```

## Installation

Afterwards, install the dependencies:

```{% title="Command" %}
$ npm install
```

## Platform agnostic usage

While Featurevisor project itself depends on Node.js, your applications do not need to.

The idea is that a Featurevisor project will generate [datafiles](/docs/building-datafiles/) (static JSON files), which will later be consumed by applications using [SDKs](/docs/sdks/) in different programming languages which do not need to have any ties to Node.js in any way.

## Directory structure

```{% title="Command" %}
$ tree .
.
├── attributes/
│   ├── country.yml
│   ├── deviceId.yml
│   └── userId.yml
├── datafiles/ (generated later)
│   ├── production/
│   │   └── featurevisor-tag-all.json
│   └── staging/
│       └── featurevisor-tag-all.json
├── features
│   └── showCookieBanner.yml
├── featurevisor.config.js
├── package.json
├── segments
│   └── netherlands.yml
└── tests
    ├── features
    │   └── showCookieBanner.spec.yml
    └── segments
        └── netherlands.spec.yml
```

### Project configuration

- `featurevisor.config.js`: contains your project configuration. Learn more in [Configuration](/docs/configuration/) page.

### Building blocks

These are the directories where you will be defining all the building blocks for managing your features:

- `attributes/`: contains all your [attribute](/docs/attributes/) definitions
- `segments/`: contains all your reusable [segments](/docs/segments/), which work as targeting conditions
- `features/`: contains all your [feature](/docs/features/) definitions
- `tests/`: contains all your [test specs](/docs/testing/) against your features and segments

### Output

- `datafiles/`: contains all your generated [datafiles](/docs/building-datafiles/), which are meant to be consumed by [SDKs](/docs/sdks/javascript/) in your applications

## Git repository

While it is intended that a Featurevisor project should be hosted in a standalone Git repository, it is not a strict requirement.

```{% title="Command" %}
$ git init
$ git add .
$ git commit -m "Initial commit"
```

You can still use the CLI to manage your project without a Git repository, or as part of your larger application codebase (think a monorepo setup).

However, it is highly recommended to use a standalone Git repository to keep track of your changes and collaborate with others. Keeping it separate from your application codebase allows you to [decouple](/docs/use-cases/decouple-releases-from-deployments/) your feature changes from your application code deployments.
