# Querying a project

When the user asks **about** a project ("what is enabled?", "who uses this segment?", "why is this off for me?"), use the CLI rather than reading YAML. Its `--json` output is authoritative and parseable. Option details are in [cli.md](cli.md).

## Why does this context get this value?

The most common question. Do not reason from the YAML by hand:

```bash
npx featurevisor evaluate \
  --feature=checkout \
  --context='{"userId":"9b30","country":"de"}' \
  --explain
```

Read the explanation in this order:

1. **Which step decided**: a sticky value, a force entry, unmet root conditions (`conditions_unmet`), a rule (`rule`, `allocated`), or `no_match`. `no_match` means either that no rule's conditions matched, or that a rule matched but the bucket is above its percentage. The probes and the bucket tell which.
2. **The probes**: each condition leaf with its actual value and pass or fail. A failing leaf on a rule that should have matched is usually a context problem: a missing attribute, a different spelling or casing, or a value of the wrong type.
3. **The bucket**: `Bucket: 67208 / 100000` means 67.208. A rule at 25% excludes it. The bucket depends only on the feature key and the `bucketBy` values, so the same user always lands in the same place.

For a global variable, pass `--variable` instead. The explanation names the matched override, its nested path, and for accumulating overrides every matched step and the operations applied. For a composition, it lists each member's source and final value.

`evaluate` also warns when the context does not fit the declared attributes, which catches values such as `"NL"` against a lowercase pattern or a date without a timezone.

**When an application disagrees with the CLI**, the definitions are rarely the cause. Compare, in this order:

1. The datafile revision the application loaded (`f.getRevision()`) with the latest deployment. Applications refresh on their own schedule, and a cache in front of the datafiles can serve an older copy for its lifetime.
2. The target and environment of the datafile it loaded. A feature missing from that datafile evaluates as disabled with `feature_not_found`.
3. The exact context it passed, including attribute names and types.
4. Sticky values set in the application, which win over the datafile.

## What is enabled where?

Without environments:

```bash
npx featurevisor list --features --enabled --json --pretty
npx featurevisor list --features --disabled --json --pretty
```

With environments configured:

```bash
npx featurevisor list --features --enabled-in=production --json --pretty
npx featurevisor list --features --enabled-in=staging --disabled-in=production --json --pretty
```

The last is the "waiting to be released" report. These filters read rule percentages only: a feature with a 0% rule can still be on for a force entry, and a rule above 0% can still be off behind root conditions.

## Experiments, variables and tests

```bash
npx featurevisor list --features --with-variations --json --pretty
npx featurevisor list --features --variation=treatment --json --pretty
npx featurevisor list --features --variable=paymentMethods --json --pretty
npx featurevisor list --features --without-tests --json --pretty
npx featurevisor test --uncovered
```

Filters combine with AND, so a multi part question is one call:

```bash
npx featurevisor list --features \
  --tag=web \
  --with-variations \
  --without-tests \
  --json --pretty
```

## What uses this, and what does it use?

```bash
npx featurevisor find-usage --segment=netherlands
npx featurevisor find-usage --attribute=country
npx featurevisor find-usage --feature=checkout
npx featurevisor find-usage --variable=supportEmail
```

Run these before renaming, archiving or deleting. `--feature` lists features and global variables that reference it in conditions or compositions. `--variable` shows both directions: its dependencies and what references it. Add `--authors` to see who last touched each file. Application code is not part of the project, so search it separately for SDK calls.

## What is unused or duplicated?

```bash
npx featurevisor find-usage --unused-segments
npx featurevisor find-usage --unused-attributes
npx featurevisor find-duplicate-segments
```

## Which flags are stale?

Candidates are features at an unconditional 100% with no variations:

```bash
npx featurevisor list --features --enabled --without-variations --json --pretty
npx featurevisor list --features --enabled-in=production --without-variations --json --pretty
```

The first is for projects without environments, the second for projects with them.

Confirm every environment's last rule is `conditions: '*'` at 100, check age in Git, then follow the [cleanup recipe](recipes.md#cleaning-up-stale-flags).

## Will this rollout split as intended?

```bash
npx featurevisor assess-distribution \
  --feature=checkout \
  --context='{"country":"de"}' \
  --populate-uuid=userId \
  --n=10000
```

Generates users and reports the share enabled and the share per variation. Use a context outside any 100% rule to see the rollout percentage itself.

## What changed?

```bash
npx featurevisor diff
npx featurevisor diff --from=main --to=HEAD
```

Semantic definition changes: rollout percentages, added or removed rules and overrides, changed values. Use it for "what does this branch change?" and to summarize your own edits.

## What does the project contain?

```bash
npx featurevisor info
npx featurevisor config --json --pretty
npx featurevisor list --targets --json
npx featurevisor build --print --pretty --feature=checkout
```

`build --print` shows the compiled datafile content, here for one feature, which answers "what exactly ships for X?".

## Browse it: the Catalog

For exploring rather than querying, or for sharing with people who do not read YAML, offer the Catalog: a read-only UI of every feature, segment, attribute, global variable, target and test, with relationships, rules, variables, test coverage and Git history.

```bash
npx featurevisor catalog
```

It serves `http://127.0.0.1:3000` in watch mode, reloading on every saved change. That makes it a live review surface while you author:

1. Start it once as a background process. It is local and read-only.
2. Open the URL in your browser tool if you have one, otherwise give it to the user.
3. Every edit you save appears there, so the user reviews changes visually instead of reading YAML diffs.

Its search accepts qualifiers such as `tag:web`, `in:production`, `with:variations`, `variable:colour`, `without:tests` and `archived:false`. `uses:netherlands` finds what depends on `netherlands`, directly or not, and `usedby:chatFileUpload` finds what `chatFileUpload` depends on. `npx featurevisor catalog export` builds a static site for hosting, and `--test-report=<file>` shows results from `npx featurevisor test --json` output saved to a file.

When the person asking prefers the Catalog to the CLI, point them to where each answer lives ([Catalog docs](https://featurevisor.com/docs/catalog/#questions-it-answers)):

| Question                              | In the Catalog                                    |
| ------------------------------------- | ------------------------------------------------- |
| Who gets this feature?                | its Rules tab                                     |
| What changes if this segment changes? | its Usage tab                                     |
| Who changed this, and when?           | its History tab                                   |
| Is it tested?                         | its Tests tab, or `without:tests` in a list       |
| How do I suggest a change?            | Propose change, which opens the Git host's editor |
