# Building and deploying datafiles

Full docs:
- Building: <https://featurevisor.com/docs/building-datafiles>
- Deployment: <https://featurevisor.com/docs/deployment>
- State files: <https://featurevisor.com/docs/state-files>

Datafiles are the static JSON artifacts the SDKs consume. They are produced per environment × tag (and optionally × scope).

## Build (agent default)

```bash
npx featurevisor build --no-state-files
```

**Always pass `--no-state-files` when an agent runs build locally** — it prevents `.featurevisor/REVISION` and `.featurevisor/state-*.json` from being touched, which the user generally doesn't want in non-CI runs.

Output lands in `<datafilesDirectoryPath>` (default `dist/`):

```
dist/
├── staging/
│   └── featurevisor-tag-all.json
└── production/
    └── featurevisor-tag-all.json
```

With multiple tags and scopes, you'll see `featurevisor-tag-<tag>.json` and `featurevisor-scope-<scope>.json` files per environment.

## Build options

| Flag                                    | Effect                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| `--no-state-files`                      | Don't touch `.featurevisor/REVISION` or state-*.json            |
| `--revision <value>`                    | Stamp a custom revision into every datafile (e.g. git SHA)      |
| `--revision-from-hash`                  | Use a content hash per datafile — unchanged content = unchanged revision (great for CDN caching) |
| `--feature=<key>`                       | Print one feature's datafile entry to stdout instead of writing |
| `--environment=<env>`                   | Limit to one environment                                        |
| `--tag=<tag>`                           | Limit to one tag                                                |
| `--pretty`                              | Pretty-print the output                                         |
| `--print`                               | Print full datafile to stdout (no files written)                |

When debugging the shape of a datafile entry, prefer `--feature=<key> --print` over reading the full file.

## State files

Live under `<stateDirectoryPath>` (default `.featurevisor/`):

- `REVISION` — integer, incremented per successful build.
- `state-<environment>.json` — traffic allocation snapshots that let the *next* build maintain [consistent bucketing](bucketing.md) when percentages change.

Authoring rules:

- **CI**: builds without `--no-state-files`; commits the updated state files back with `[skip ci]`.
- **Local / agent**: builds **with** `--no-state-files`; never commit state changes from local.

The user usually has `dist/` (or wherever `datafilesDirectoryPath` points) ignored in `.gitignore`, and `.featurevisor/` *tracked*. Don't fight that layout.

## Deployment (CI pipeline)

The recommended CI sequence on merge to main:

```bash
# 1. validate
npx featurevisor lint
npx featurevisor test

# 2. build (state files allowed in CI)
npx featurevisor build

# 3. commit incremented state back to repo
git add .featurevisor/
git commit -m "[skip ci] Revision $(cat .featurevisor/REVISION)"
git push origin main

# 4. upload dist/ to CDN
#    (provider-specific: aws s3 sync, wrangler pages deploy, gh-pages, etc.)
```

When the user asks you to set this up:

- Don't run `git commit`/`git push` from an agent without explicit confirmation.
- Don't run a full `build` (without `--no-state-files`) without explicit confirmation — state changes are intended to be CI-managed.

## Consuming the deployed datafile

Once hosted (e.g. `https://cdn.example.com/production/featurevisor-tag-web.json`), SDK init looks like:

```js
import { createInstance } from '@featurevisor/sdk'

const datafile = await fetch(url).then(r => r.json())
const f = createInstance({ datafile })
```

Full SDK docs (out of scope for this skill, link only): <https://featurevisor.com/docs/sdks/javascript>

## Refreshing in production

Two common patterns:

- **Polling** — SDK refreshes the datafile periodically (e.g. every 30s).
- **Push** — your deploy pipeline broadcasts a "refresh now" signal to running apps.

Both are SDK-side concerns — out of scope here. Link: <https://featurevisor.com/docs/sdks/javascript>.

## Inspecting a datafile entry

To see what gets compiled for a specific feature without writing files:

```bash
npx featurevisor build --feature=myFeature --environment=production --print --pretty
```

This is the right tool when the user asks "what's actually in the production datafile for X?" — beats opening the JSON.
