# Featurevisor skills

Agent skills for authoring, querying, and integrating [Featurevisor](https://featurevisor.com) — Git-based feature flags, experimentation, and remote config.

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
- "Set up a brand-new Featurevisor project for my team"
- "Wire the `checkout` feature into my React app"

## What's included

A single skill, `featurevisor`, that the agent invokes (e.g. as `/featurevisor` in Claude Code) covering:

- **Authoring** — features (flags, variations, variables, force, required, expose), segments (and / or / not conditions, all operators), attributes (all types + JSON-schema-ish validation), reusable schemas, mutations for deep-merge variable overrides, groups for mutually-exclusive experiments, environments, sets, and promotions.
- **Testing** — declarative `.spec.yml` assertions, matrix expansion, sticky/children inputs, per-target and per-set runs.
- **Querying** — `list`, `find-usage`, `find-duplicate-segments`, `evaluate`, `assess-distribution` recipes for answering questions about an existing project without grepping YAML.
- **Visual review** — pairs authoring with `npx featurevisor catalog` running locally in watch mode: the agent makes changes by prompt, and the Catalog in your (or the agent's) browser live-reloads so you see every change visually.
- **Application integration** — `@featurevisor/sdk` (JavaScript/TypeScript, Node, browser, edge), `@featurevisor/react`, and `@featurevisor/vue`: context, evaluation, datafile refresh, server-side child instances, events, sticky, modules, and typed code generation. Featurevisor SDKs are cross-platform — the same datafiles and bucketing work identically in Python, Ruby, Go, Java, Swift, PHP, Roku, and more (see [featurevisor.com/docs/sdks](https://featurevisor.com/docs/sdks)).
- **Templates** — copy-and-adapt YAML for every common authoring shape, plus a complete lint- and test-passing example project.

## Updating

```bash
npx skills update featurevisor
```

## Reporting issues

This skill lives in the main Featurevisor monorepo: <https://github.com/featurevisor/featurevisor/issues>
