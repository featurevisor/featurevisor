# Building and deploying datafiles

Full docs:

- Building: <https://featurevisor.com/docs/building-datafiles>
- Deployment: <https://featurevisor.com/docs/deployment>
- State files: <https://featurevisor.com/docs/state-files>

Datafiles are the static JSON artifacts the SDKs consume. They are produced per environment × target and generated with `schemaVersion: "2"`.

## Build (agent default)

```bash
npx featurevisor build --no-state-files
```

**Always pass `--no-state-files` when an agent runs build locally** — it prevents `.featurevisor/REVISION` and `.featurevisor/existing-state-*.json` from being touched, which the user generally doesn't want in non-CI runs.

Output lands in `<datafilesDirectoryPath>` (default `datafiles/`):

```
datafiles/
├── staging/
│   └── featurevisor-all.json
└── production/
    └── featurevisor-all.json
```

With multiple targets, you'll see one `featurevisor-<target>.json` file per target and environment. Without `--target`, every configured target is built.

## Build options

| Flag                   | Effect                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `--no-state-files`     | Don't touch `.featurevisor/REVISION` or existing-state-\*.json                                   |
| `--revision <value>`   | Stamp a custom revision into every datafile (e.g. git SHA)                                       |
| `--revision-from-hash` | Use a content hash per datafile — unchanged content = unchanged revision (great for CDN caching) |
| `--feature=<key>`      | Print one feature's datafile entry to stdout instead of writing                                  |
| `--environment=<env>`  | Limit to one environment                                                                         |
| `--target=<target>`    | Build only this target; repeat to build several                                                   |
| `--pretty`             | Pretty-print the output                                                                          |
| `--print`              | Print full datafile to stdout (no files written)                                                 |

When debugging the shape of a datafile entry, prefer `--feature=<key> --print` over reading the full file.

`--json` and `--print` accept at most one target because they emit one datafile to standard output.

## State files

Live under `<stateDirectoryPath>` (default `.featurevisor/`):

- `REVISION` — integer, incremented per successful build.
- `existing-state-<environment>.json` (or `existing-state.json` in projects without environments) — traffic allocation snapshots that let the _next_ build maintain [consistent bucketing](bucketing.md) when percentages change.
- In sets projects, both live per set under `.featurevisor/sets/<set>/` — see [sets-promotions.md](sets-promotions.md).

Authoring rules:

- **CI**: builds without `--no-state-files`; commits the updated state files back with `[skip ci]`.
- **Local / agent**: builds **with** `--no-state-files`; never commit state changes from local.

The user usually has `datafiles/` (or wherever `datafilesDirectoryPath` points) ignored in `.gitignore`, and `.featurevisor/` _tracked_. Don't fight that layout.

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

# 4. upload datafiles/ to CDN
#    (provider-specific: aws s3 sync, wrangler pages deploy, gh-pages, etc.)
```

When the user asks you to set this up:

- Don't run `git commit`/`git push` from an agent without explicit confirmation.
- Don't run a full `build` (without `--no-state-files`) without explicit confirmation — state changes are intended to be CI-managed.

Step-by-step hosting guides exist for common providers — fetch the matching one instead of improvising:

- GitHub Actions: <https://featurevisor.com/docs/integrations/github-actions>
- Cloudflare Pages: <https://featurevisor.com/docs/integrations/cloudflare-pages>
- GitHub Pages: <https://featurevisor.com/docs/integrations/github-pages>
- PartyKit: <https://featurevisor.com/docs/integrations/partykit>
- General deployment guidance: <https://featurevisor.com/docs/deployment>

## Consuming the deployed datafile

Once hosted (e.g. `https://cdn.example.com/production/featurevisor-web.json`), SDK init looks like:

```js
import { createFeaturevisor } from '@featurevisor/sdk'

const datafile = await fetch(url).then(r => r.json())
const f = createFeaturevisor({ datafile })
```

For full SDK integration (context, evaluation, refresh, React/Vue, server-side), read [sdk-javascript.md](sdk-javascript.md).

## Refreshing in production

Two common patterns:

- **Polling** — the application refetches the datafile periodically (e.g. every 5 minutes) and calls `setDatafile` again.
- **Push** — your deploy pipeline broadcasts a "refresh now" signal (websocket/SSE) to running apps.

Both are application-side concerns — see [sdk-javascript.md](sdk-javascript.md#keeping-the-datafile-fresh).

## Inspecting a datafile entry

To see what gets compiled for a specific feature without writing files:

```bash
npx featurevisor build --feature=myFeature --environment=production --print --pretty
```

This is the right tool when the user asks "what's actually in the production datafile for X?" — beats opening the JSON.
