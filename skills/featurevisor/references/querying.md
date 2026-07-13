# Querying a Featurevisor project

When the user asks **about** the project — "what's enabled in production?", "who uses this segment?", "why is this feature off for me?" — **use the CLI, not grep**. Outputs are authoritative and parseable with `--json --pretty`.

The full CLI reference is in [cli.md](cli.md). This file is the playbook for common questions.

## "What features are enabled in production?"

```bash
npx featurevisor list --features --enabledIn=production --json --pretty
```

Pair with `--tag` to narrow to a surface:

```bash
npx featurevisor list --features --enabledIn=production --tag=web --json --pretty
```

## "What features are disabled in staging?"

```bash
npx featurevisor list --features --disabledIn=staging --json --pretty
```

## "What features have an A/B test running?"

```bash
npx featurevisor list --features --with-variations --json --pretty
```

For a specific variation value (e.g. anyone running a `treatment` arm):

```bash
npx featurevisor list --features --variation=treatment --json --pretty
```

## "What features expose variable X?"

```bash
npx featurevisor list --features --variable=bgColor --json --pretty
```

## "What features lack test coverage?"

```bash
npx featurevisor list --features --without-tests --json --pretty
```

## "What's live in staging but not in production yet?"

Filters combine (intersection), so environment-parity questions are one call:

```bash
npx featurevisor list --features --enabledIn=staging --disabledIn=production --json --pretty
```

This is the "what's waiting to be released" report — useful before release reviews or when a PM asks what's in the pipeline.

## "Which flags are stale and ready for cleanup?"

Candidates are features enabled everywhere with no experiment attached:

```bash
npx featurevisor list --features --enabledIn=production --without-variations --json --pretty
```

Cross-check each candidate's rules for an unconditional 100% and its Git history for age, then follow the [cleanup recipe](recipes.md#cleaning-up-stale-flags).

## "Which features use this segment?"

```bash
npx featurevisor find-usage --segment=netherlands
npx featurevisor find-usage --segment=netherlands --authors    # also list git authors
```

## "Which features / segments use this attribute?"

```bash
npx featurevisor find-usage --attribute=country
```

## "What segments / attributes are unused?"

```bash
npx featurevisor find-usage --unusedSegments
npx featurevisor find-usage --unusedAttributes
```

## "Where do we have duplicate segment logic?"

```bash
npx featurevisor find-duplicate-segments
npx featurevisor find-duplicate-segments --authors
```

## "Why is feature X evaluating to <value> for this user?"

This is the killer question for debugging. Don't read YAML and reason by hand — let the CLI do it:

```bash
npx featurevisor evaluate \
  --environment=production \
  --feature=myFeature \
  --context='{"userId":"u_123","country":"nl","plan":"pro"}' \
  --verbose
```

Add `--variation` or `--variable=<key>` to debug variation / variable outputs specifically. Add `--json --pretty` for parseable output.

Add repeatable `--target=<target>` options to evaluate the exact selected target datafiles independently.

The evaluation trace walks through sticky → required → force → rules → bucketing → fallback. See [features.md](features.md#evaluation-flow) for the order.

## "Will this 25% rollout actually distribute correctly?"

```bash
npx featurevisor assess-distribution \
  --environment=production \
  --feature=myFeature \
  --context='{"country":"nl"}' \
  --populateUuid=userId \
  --n=10000
```

`--populateUuid=userId` synthesizes a fresh user per iteration. Repeat the flag for multi-attribute bucketing. Bump `--n` higher for tighter distribution estimates.

Add repeatable `--target=<target>` options to assess each selected target datafile independently.

## "What does the project even contain?"

```bash
npx featurevisor info
```

Counts of features, segments, attributes, tests, groups, schemas.

Add repeatable `--target=<target>` options for per-target and per-environment datafile counts and sizes.

## "What does the config look like?"

```bash
npx featurevisor config --json --pretty
```

## "Can I just browse everything?" (Catalog)

When the user wants to *explore* rather than query — or wants something to share with less technical teammates — offer the Catalog: a read-only web UI showing every feature, segment, attribute, target, group, and schema with relationships, rules, variables, test coverage, and Git history.

```bash
npx featurevisor catalog                 # export + serve at http://127.0.0.1:3000 + watch mode (live reload)
npx featurevisor catalog export          # build static output to catalog/ for hosting
npx featurevisor catalog serve           # serve a previous export
```

Its feature search supports qualifiers like `tag:web`, `in:production`, `with:variations`, `variable:bgColor`, `archived:false`. The export deploys to any static host. Full docs: <https://featurevisor.com/docs/catalog>.

### Pair it with an authoring session (best experience)

The no-subcommand form runs in **watch mode**: it rebuilds project data and reloads the browser whenever definition files change. That turns the Catalog into a live visual review surface for agent-driven authoring:

1. Start `npx featurevisor catalog` as a background process (local, read-only — safe to leave running for the whole session).
2. If you have a browser tool, open `http://127.0.0.1:3000` in it; otherwise tell the user to open that URL.
3. As you author features, segments, and tests, every save appears in the Catalog immediately — the user reviews changes visually instead of reading YAML diffs.

Offer this proactively for multi-change sessions and for PMs/marketers/vibe coders who'd rather see the project than read it. Use `--port=<n>` if 3000 is taken.

## Workflow tip

When answering a multi-part question ("show me all web features in production that have an A/B test running and no tests"), chain filters in one `list` call rather than running multiple and intersecting. The JSON output then feeds directly into your reasoning:

```bash
npx featurevisor list --features \
  --tag=web \
  --enabledIn=production \
  --with-variations \
  --without-tests \
  --json --pretty
```
