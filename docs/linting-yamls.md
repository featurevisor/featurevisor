---
title: Linting YAMLs
description: Lint your Featurevisor YAML files
---

Featurevisor provides a CLI command to lint your YAML files, making sure they are all valid and won't cause any issues when you build your datafiles. {% .lead %}

## Usage

Run:

```
$ featurevisor lint
```

And it will show you the errors in your YAML files, if any.

If any errors are found, it will terminate with a non-zero exit code.
