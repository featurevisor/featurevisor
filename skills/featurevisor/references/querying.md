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

## "What does the project even contain?"

```bash
npx featurevisor info
```

Counts of features, segments, attributes, tests, groups, schemas.

## "What does the config look like?"

```bash
npx featurevisor config --json --pretty
```

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
