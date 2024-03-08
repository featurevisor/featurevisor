---
title: Deployment
description: Deploy your Featurevisor project datafiles
---

Once you have built your datafiles, you can deploy them to your CDN or any other static file hosting service. {% .lead %}

We recommend that you set up a CI/CD pipeline to automate the build and deployment process, instead of doing it from your local machine.

## Steps involved

When a new Pull Request (branch) is merged, the CI/CD pipeline should:

### Linting

Lint all the attributes, segments, and feature definitions:

```
$ featurevisor lint
```

### Testing

Test all the features and segments:

```
$ featurevisor test
```

### Build the datafiles

```
$ featurevisor build
```

### Commit the state files

```
$ git add .featurevisor/*
$ git commit -m "State files"
```

Only the [state files](/docs/state-files) should be committed as available under `.featurevisor` directory. The generated datafiles in `dist` directory are ignored from Git.

### Upload to your CDN

This step is specific to your CDN provider or custom infrastructure.

You can use the `dist` directory as the root directory for your CDN.

### Push commits back to upstream

We want to make sure the next Pull Request merge will be on top of the latest version and state files.

```
$ git push origin main
```

If any of the steps above fail, the CI/CD pipeline should stop and notify the team.

## Fully functional example

You can refer to the CI/CD guide for [GitHub Actions](/docs/integrations/github-actions) and [Cloudflare Pages](/docs/integrations/cloudflare-pages) if you want a fully functional real-world example of setting up a Featurevisor project.

Repo is available here: [https://github.com/featurevisor/featurevisor-example-cloudflare](https://github.com/featurevisor/featurevisor-example-cloudflare).
