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

## Generate a status site

Use Featurevisor CLI:

```
$ featurevisor site export
```

The generated static site will be available in the `out` directory.

## Serve the site locally

Run:

```
$ featurevisor site serve
```

## Advanced search

The generated website supports advanced search besides just searching by name of your features, segments, or attributes.

Examples:

- `my keyword`: plain search
- `tag:my-tag`: search features by tag
- `in:production`: search features by environment
- `archived:true` or `archived:false`
- `capture:true` or `capture:false`: for filtering attributes
