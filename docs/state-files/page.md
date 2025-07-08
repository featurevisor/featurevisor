---
title: State files
nextjs:
  metadata:
    title: State files
    description: Learn about Featurevisor state files
    openGraph:
      title: State files
      description: Learn about Featurevisor state files
      images:
        - url: /img/og/docs.png
---

When you build your datafiles, Featurevisor generates some additional JSON files that are used to keep track of the most recently deployed build of your project. These files are called state files. {% .lead %}

## Location

They are located in the `.featurevisor` directory. You don't have to deal with them directly ever.

## What do they contain?

### Traffic allocation

Traffic allocation information is important to keep track of so that the next build can maintain [consistent bucketing](/docs/bucketing) for your users against individual features.

### Revision

Next to the JSON files for traffic allocation, it will also create and maintain a `REVISION` file which an integer value incremented by every successful build.

This revision number will be present in your [generated datafiles](/docs/building-datafiles).

## Committing state files

It is recommended that you keep your state files in the Git repository, but not manually commit them yourself when sending Pull Requests.

We will learn more about it in [Deployment](/docs/deployment).
