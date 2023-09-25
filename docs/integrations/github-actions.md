---
title: GitHub Actions (GHA)
description: Learn how to set up CI/CD workflows with GitHub Actions for Featurevisor
ogImage: /img/og/docs-integrations-github-actions.png
---

Set up continuous integration and deployment of your Featurevisor project with GitHub Actions. {% .lead %}

Find more info about GitHub Actions [here](https://github.com/features/actions).

## Repository settings

Make sure you have `Read and write permissions` enabled in your GitHub repository's `Settings > Actions > General > Workflow permissions` section.

## Workflows

We will be covering two workflows for our set up with GitHub Actions.

### Checks

This workflow will be triggered on every push to the repository targeting any non-master or non-main branches.

This will help identify any issues with your Pull Requests early before you merge them to your main branch.

```yml
# .github/workflows/checks.yml
name: Checks

on:
  push:
    branches-ignore:
      - main
      - master

jobs:
  checks:
    name: Checks
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v2
        with:
          node-version: 16

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Test specs
        run: npm test
```

### Publish

This workflow is intended to be run on every push to your main (or master) branch, and is supposed to handle uploading of your generated datafiles as well:

```yml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    branches:
      - main
      - master

jobs:
  ci:
    name: Publish
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v2
        with:
          node-version: 16

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Git configs
        run: |
          git config user.name "${{ github.actor }}"
          git config user.email "${{ github.actor }}@users.noreply.github.com"

      - name: Version
        run: npm version patch

      - name: Build
        run: npm run build

      - name: Test specs
        run: npm test

      - name: Upload datafiles
        run: echo "Uploading..."
        # Update it accordingly based on your CDN set up

      - name: Push back to origin
        run: |
          git add .featurevisor/*
          git commit --amend --no-edit
          git push
```

After generating new datafiles and uploading them, the workflow will also take care of pushing the Featurevisor [state files](/docs/state-files) back to the repository, so that future builds will be built on top of latest state.

If you want an example of an actual uploading step, see [Cloudflare Pages](/docs/integrations/cloudflare-pages/) integration guide.
