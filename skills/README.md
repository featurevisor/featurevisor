# Featurevisor skills

Agent skills for authoring and querying [Featurevisor](https://featurevisor.com) projects — Git-based feature flags and experimentation.

Installable via [`npx skills`](https://www.skills.sh):

```bash
# inside your Featurevisor project (or your app repo)
npx skills add featurevisor/featurevisor

# or pin to the path directly
npx skills add https://github.com/featurevisor/featurevisor/tree/main/skills/featurevisor
```

Then in your agent (Claude Code, Cursor, Codex, OpenCode, etc.) ask things like:

- "Create a `showCheckoutBanner` feature, rolled out 10% to users in NL"
- "Why is `sidebar` evaluating to disabled for me?"
- "Which features depend on `checkoutRedesign`?"
- "Add an A/B test variation to `pricingPage`"
- "What features are enabled in production without test coverage?"

## What's included

A single skill, `featurevisor`, that the agent invokes (e.g. as `/featurevisor` in Claude Code) covering:

- **Authoring** — features (flags, variations, variables, force, required, expose), segments (and / or / not conditions, all operators), attributes (all types + JSON-schema-ish validation), reusable schemas, mutations for deep-merge variable overrides, groups for mutually-exclusive experiments, environments (both inline and `splitByEnvironment`).
- **Testing** — declarative `.spec.yml` assertions, matrix expansion, tagged/scoped runs.
- **Querying** — `list`, `find-usage`, `find-duplicate-segments`, `evaluate`, `assess-distribution` recipes for answering questions about an existing project without grepping YAML.
- **Templates** — copy-and-adapt YAML for every common authoring shape.

SDK / application integration is intentionally out of scope — the skill links to <https://featurevisor.com/docs/sdks> on demand.

## Updating

```bash
npx skills update featurevisor
```

## Reporting issues

This skill lives in the main Featurevisor monorepo: <https://github.com/featurevisor/featurevisor/issues>
