# Building and deploying datafiles

Full docs:

- Building: <https://featurevisor.com/docs/building-datafiles/>
- Deployment: <https://featurevisor.com/docs/deployment/>
- State files: <https://featurevisor.com/docs/state-files/>

Datafiles are the static JSON files SDKs load. The CLI builds one per target, and per environment when environments are configured. Each contains the target's selected features and global variables plus everything they reference, with `schemaVersion: "4"`. Only v4 SDKs read v4 datafiles correctly ([upgrading-to-v4.md](upgrading-to-v4.md)).

Treat a datafile as public. A browser or app that loads it can read every key and value inside, so a feature named after an unannounced product can be seen before its launch. Datafiles must never contain secrets.

## Two kinds of build

Bare `npx featurevisor build` is the **CI command**. Besides writing datafiles, it increments `.featurevisor/REVISION` and updates the state files that keep variation allocations stable between builds. The deploying pipeline commits them.

**Every local build, yours and the user's, uses `--no-state-files`:**

```bash
npx featurevisor build --no-state-files
```

It writes the same datafiles and reports the same errors, without touching revision or state. If the user runs bare `build` by habit, point out the difference and that local state changes should not be committed.

## Output

```
datafiles/
└── featurevisor-all.json
```

That is the default scaffold. Each target adds `featurevisor-<target>.json`. Environments add a directory per environment, such as `datafiles/production/featurevisor-web.json`. Sets add a directory per set before that. `datafilesDirectoryPath` and `datafileNamePattern` in the configuration change the location and names.

## Options

| Option                                | Effect                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `--no-state-files`                    | leave `REVISION` and state files untouched                                  |
| `--target=<target>`                   | build only this target. Repeat for several                                  |
| `--environment=<env>`                 | build one configured environment. Rejected in projects without environments |
| `--set=<set>`                         | build one set                                                               |
| `--print`                             | print one datafile to stdout instead of writing files                       |
| `--pretty`                            | format printed JSON                                                         |
| `--feature=<key>`, `--variable=<key>` | build only that definition and what it references, typically with `--print` |
| `--revision=<value>`                  | stamp a chosen revision                                                     |
| `--revision-from-hash`                | derive each datafile's revision from its content                            |
| `--datafiles-dir=<dir>`               | write somewhere else for this run                                           |

`--print` and `--json` emit one datafile, so they take at most one target. In a project with environments, `--print` also needs `--environment`.

To see exactly what ships for one feature:

```bash
npx featurevisor build --print --pretty --feature=checkout
```

## Run lint and tests first

Build does not run full lint. It catches broken references and dependency cycles, but a rule that still uses the removed `segments` field builds without it and then matches nobody, and a malformed date operand passes. CI must run lint and tests before building:

```bash
npx featurevisor lint
npx featurevisor test
npx featurevisor build
```

## Deployment

The usual pipeline on merge to the main branch:

1. Lint and test.
2. Build, with state files.
3. Commit the updated `.featurevisor/` back, typically with `[skip ci]` in the message, and push it.
4. Upload `datafiles/` to a CDN or static host.

Push the state before uploading, so a rejected push stops the run before anything is published. Run one deployment at a time, such as through a GitHub Actions concurrency group, because two builds starting from the same state cannot both push. Never force push state.

Do not run `git commit`, `git push` or a bare `build` on the user's behalf without explicit confirmation. Most projects ignore `datafiles/` in Git and track `.featurevisor/`, so keep that layout.

Hosting guides: [GitHub Actions](https://featurevisor.com/docs/integrations/github-actions/), [Cloudflare Pages](https://featurevisor.com/docs/integrations/cloudflare-pages/), [GitHub Pages](https://featurevisor.com/docs/integrations/github-pages/) and [general deployment](https://featurevisor.com/docs/deployment/). Fetch the matching one rather than improvising.

A build with `--environment` writes only that environment while advancing the shared revision. Build every environment before publishing the whole output directory.

## Consuming datafiles

```js
import { createFeaturevisor } from '@featurevisor/sdk'

const response = await fetch('https://cdn.yoursite.com/featurevisor-all.json')
if (!response.ok) throw new Error(`HTTP ${response.status}`)
const f = createFeaturevisor({ datafile: await response.json() })
```

Applications refresh by polling or on a push signal, and call `setDatafile` with the new content ([sdk-javascript.md](sdk-javascript.md#set-and-refresh-the-datafile)). A change goes live after merge, build and upload, then the cache in front of the datafiles, then each application's next refresh. With a five minute cache and a five minute refresh interval, it can take ten minutes after deployment to reach everyone. See [how long a change takes](https://featurevisor.com/docs/deployment/#how-long-a-change-takes).
