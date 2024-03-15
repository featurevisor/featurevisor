---
title: GitHub Pages
description: Learn how to upload Featurevisor datafiles to GitHub Pages
# TODO: Fix image
ogImage: /img/og/docs-integrations-github-pages.png
---

Set up continuous integration and deployment of your Feaurevisor project with GitHub Actions and GitHub Pages. {% .lead %}

See more about GitHub Actions set up in previous guide [here](/docs/integrations/github-actions).

## Creating a new project

This guide assumes you have created a new Featurevisor project using the CLI:

```
$ mkdir my-featurevisor-project && cd my-featurevisor-project

$ npx @featurevisor/cli init
$ npm install
```

## GitHub Pages

We are going to be uploading to and serving our datafiles from [GitHub Pages](https://pages.github.com/).

GitHub Pages is a product that allows you to host your static sites and apps on GitHub's global network. Given Featurevisor project generates static datafiles (JSON files), it is a great fit for our use case.

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
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npx featurevisor lint

      - name: Test specs
        run: npx featurevisor test

      - name: Build
        run: npx featurevisor build
```

### Publish

This workflow is intended to be run on every push to your main (or master) branch, and is supposed to handle publishing your generated datafiles to GitHub Pages:

```yml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    branches:
      - main
      - master

# Sets permissions of the GITHUB_TOKEN to allow deployment to GitHub Pages
permissions:
  contents: write
  pages: write
  id-token: write

# Allow only one concurrent deployment, skipping runs queued between the run in-progress and latest queued.
# However, do NOT cancel in-progress runs as we want to allow these production deployments to complete.
concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  publish:
    name: Publish
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npx featurevisor lint

      - name: Test specs
        run: npx featurevisor test

      - name: Build
        run: npx featurevisor build

      - name: Create index.html
        run: echo "<html><body>It works.</body></html>" > dist/index.html

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: 'dist'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4

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

Once uploaded, your datafiles will be accessible as: `https://<username>.github.io/<repo>/<environment>/datafile-tag-<your-tag>.json`.

You may want to take it a step further by [setting up custom domains (or subdomains)](https://docs.github.com/articles/using-a-custom-domain-with-github-pages/) for your GitHub Pages project. Otherwise, you are good to go.

Learn how to consume datafiles from URLs directly using [SDKs](/docs/sdks).

## Full example

You can find a fully functional repository based on this guide here: [https://github.com/meirroth/featurevisor-example-github](https://github.com/meirroth/featurevisor-example-github).

## Sequential builds

In case you are worried about simultaneous builds triggered by multiple Pull Requests merged in quick succession, you can learn about mitigating any unintended issues [here](/docs/integrations/github-actions/#sequential-builds).
