---
title: Cloudflare Pages
nextjs:
  metadata:
    title: Cloudflare Pages
    description: Learn how to upload Featurevisor datafiles to Cloudflare Pages
    openGraph:
      title: Cloudflare Pages
      description: Learn how to upload Featurevisor datafiles to Cloudflare Pages
      images:
        - url: /img/og/docs-integrations-cloudflare-pages.png
---

Set up continuous integration and deployment of your Feaurevisor project with GitHub Actions and Cloudflare Pages. {% .lead %}

See more about GitHub Actions set up in previous guide [here](/docs/integrations/github-actions).

## Creating a new project

This guide assumes you have created a new Featurevisor project using the CLI:

```{% title="Command" %}
$ mkdir my-featurevisor-project && cd my-featurevisor-project

$ npx @featurevisor/cli init
$ npm install
```

## Cloudflare Pages

We are going to be uploading to and serving our datafiles from [Cloudflare Pages](https://pages.cloudflare.com/).

Cloudflare Pages is a product that allows you to host your static sites and apps on Cloudflare's global network. Given Featurevisor project generates static datafiles (JSON files), it is a great fit for our use case.

Make sure you already have a Cloudflare Pages project set up, and then use it in the publish workflow later.

{% callout type="note" title="Note about Cloudflare Pages automatic deployments" %}
Cloudflare Pages is set to auto-deploy your site on every push. This could interfere with our GitHub publish action. To prevent this, you can turn off auto deployment by following the steps in this [Cloudflare documentation](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).
{% /callout %}

## Secrets

Follow the guide [here](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), and set up these two secrets in your GitHub repository's `Settings > Secrets and variables > Actions` section:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Repository settings

Make sure you have `Read and write permissions` enabled in your GitHub repository's `Settings > Actions > General > Workflow permissions` section.

## Workflows

We will be covering two workflows for our set up with GitHub Actions.

### Checks

This workflow will be triggered on every push to the repository targeting any non-master or non-main branches.

This will help identify any issues with your Pull Requests early before you merge them to your main branch.

```yml {% path=".github/workflows/checks.yml" %}
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

This workflow is intended to be run on every push to your main (or master) branch, and is supposed to handle uploading of your generated datafiles to Cloudflare Pages:

```yml {% path=".github/workflows/publish.yml" %}
name: Publish

on:
  push:
    branches:
      - main
      - master

jobs:
  publish:
    name: Publish
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

      - name: Upload to Cloudflare Pages
        run: |
          echo "<html><body>It works.</body></html>" > datafiles/index.html
          npx wrangler pages deploy datafiles --project-name="YOUR_CLOUDFLARE_PAGES_PROJECT_NAME"
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

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

After generating new [datafiles](/docs/building-datafiles/) and uploading them, the workflow will also take care of pushing the Featurevisor [state files](/docs/state-files) back to the repository, so that future builds will be built on top of latest state.

Once uploaded, your datafiles will be accessible as:

`https://<your-project>.pages.dev/<environment>/featurevisor-tag-<your-tag>.json`.

You may want to take it a step further by setting up custom domains (or subdomains) for your Cloudflare Pages project. Otherwise, you are good to go.

Learn how to consume datafiles from URLs directly using [SDKs](/docs/sdks).

## Full example

You can find a fully functional repository based on this guide here: [https://github.com/featurevisor/featurevisor-example-cloudflare](https://github.com/featurevisor/featurevisor-example-cloudflare).

## Sequential builds

In case you are worried about simultaneous builds triggered by multiple Pull Requests merged in quick succession, you can learn about mitigating any unintended issues [here](/docs/integrations/github-actions/#sequential-builds).
