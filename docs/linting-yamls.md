---
title: Linting YAMLs
description: Lint your Featurevisor YAML files
---

Featurevisor provides a CLI command to lint your YAML files, making sure they are all valid and won't cause any issues when you build your datafiles. {% .lead %}

## Usage

```
$ featurevisor lint
```

And it will show you the errors in your YAML files, if any.

If any errors are found, it will exit with a non-zero exit code.
