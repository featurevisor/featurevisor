---
title: GitHub Actions (GHA)
description: Learn how to set up CI/CD workflows with GitHub Actions for Featurevisor
ogImage: /img/og/docs-integrations-github-actions.png
---

Set up continuous integration and deployment of your Featurevisor project with GitHub Actions. {% .lead %}

Find more info about GitHub Actions [here](https://github.com/features/actions).

## Creating a new project

This guide assumes you have created a new Featurevisor project using the CLI:

```
$ mkdir my-featurevisor-project && cd my-featurevisor-project
$ npx @featurevisor/cli init
```

The initialized project will already contain the npm scripts for linting, building, and testing your project:

- `lint`: `featurevisor lint`
- `build`: `featurevisor build`
- `test`: `featurevisor test`

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

      - name: Test specs
        run: npm test

      - name: Build
        run: npm run build
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

      - name: Test specs
        run: npm test

      - name: Build
        run: npm run build

      - name: Upload datafiles
        run: echo "Uploading..."
        # Update it accordingly based on your CDN set up

      - name: Git configs
        run: |
          git config user.name "${{ github.actor }}"
          git config user.email "${{ github.actor }}@users.noreply.github.com"

      - name: Push back to origin
        run: |
          git add .featurevisor/*
          git commit -m "[skip ci] Revision $(cat .featurevisor/REVISION)"
          git push
```

After generating new datafiles and uploading them, the workflow will also take care of pushing the Featurevisor [state files](/docs/state-files) back to the repository, so that future builds will be built on top of latest state.

If you want an example of an actual uploading step, see [Cloudflare Pages](/docs/integrations/cloudflare-pages/) integration guide.

## Sequential builds

It is possible you might want to run the publish workflow sequentially for every merged Pull Requests, in case multiple Pull Requests are merged in quick succession.

### Queue

You can consider using [softprops/turnstyle](https://github.com/softprops/turnstyle) GitHub Action to run publish workflow of all your merged Pull Requests sequentially.

### Branch protection rules

Next to it, you can also make it stricter by requiring all Pull Request authors to have their branches up to date from latest main branch before merging:

- [Managing suggestions to update pull request branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-suggestions-to-update-pull-request-branches)
- [Create branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule#creating-a-branch-protection-rule) (see #7)
  -  Require branches to be up to date before merging
