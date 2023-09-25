---
title: Linting
description: Lint your Featurevisor definition files
---

Featurevisor provides a CLI command to lint your definition files, making sure they are all valid and won't cause any issues when you build your datafiles. {% .lead %}

## Usage

Run:

```
$ featurevisor lint
```

And it will show you the errors in your definition files, if any.

If any errors are found, it will terminate with a non-zero exit code.
