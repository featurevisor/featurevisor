---
title: Status site generator
description: Learn how to generate status website using Featurevisor
---

To get a quick overview of all the feature flags, segments, and attributes (and their history of changes) in your Featurevisor project, you can generate a static website for your team or organization. {% .lead %}

## Why generate a site?

As your project grows, it becomes harder to keep track of all the feature flags, segments, and attributes especially if you want to know the current status in any specific environment quickly.

The status site generator helps you to keep track of all the changes in your project via a nice and usable static website, that you can generate every time there's a change in your project repository.

This also helps communicate the current state of things to your wider organization, especially to those who aren't developers.

## Pre-requisites

It is expected that you already have a Featurevisor project with some feature flags, and you have already initialized your git repository with at least one commit.

The git repo also needs to have an `origin` remote set up, in order for the edit links to work in the generated website.

## Generate a status site

Use Featurevisor CLI:

```
$ npx featurevisor site export
```

The generated static site will be available in the `out` directory.

## Serve the site locally

Run:

```
$ npx featurevisor site serve
```

## Screenshots

Screenshots here may differ from latest site generator.

### Features list

[![Features list](/img/site-screenshot-features.png)](/img/site-screenshot-features.png)

### Feature details

[![Feature details](/img/site-screenshot-feature-view.png)](/img/site-screenshot-feature-view.png)

### History

[![History](/img/site-screenshot-history.png)](/img/site-screenshot-history.png)

## Advanced search

The generated website supports advanced search besides just searching by name of your features, segments, or attributes.

Examples:

- `my keyword`: plain search
- `tag:my-tag`: search features by tag
- `in:production`: search features by environment
- `archived:true` or `archived:false`
- `capture:true` or `capture:false`: for filtering attributes
- `with:variations` or `without:variations`: for filtering features with/without variations
- `variation:variation-value`: for filtering features by variation value
- `with:variables` or `without:variables`: for filtering features with/without variables
- `variable:variable-key`: for filtering features by variable key

## Read-only mode

It is important to note that the generated site is a static one, and therefore it is read-only.

To make any changes to your features, segments, or attributes, you will have to make those changes in your Git repository.
