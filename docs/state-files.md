---
title: State files
description: Learn about Featurevisor state files
---

When you build your datafiles, Featurevisor generates some additional JSON files that are used to keep track of the most recently delpoyed build of your project. These files are called state files. {% .lead %}

## Location

They are located in the `.featurevisor` directory.

You don't have to deal with them directly ever, but they contain valuable rollout information for the next build to maintain consistent bucketing of your users against features.

## Committing state files

It is recommended that you keep your state files in the git repository.

We will learn more about it in [Deployment](/docs/deployment).
