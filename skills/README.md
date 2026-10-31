# Featurevisor skills

Agent skills for authoring, testing, querying and integrating [Featurevisor](https://featurevisor.com): feature flags, experiments and remote configuration managed in Git.

Install with [`npx skills`](https://www.skills.sh):

```bash
# inside your Featurevisor project, or your application repository
npx skills add featurevisor/featurevisor

# or point at the path directly
npx skills add https://github.com/featurevisor/featurevisor/tree/main/skills/featurevisor
```

Then ask your agent (Claude Code, Codex, Cursor, OpenCode and others), for example with `/featurevisor` in Claude Code. You do not need to know the YAML to ask: product managers and support colleagues can ask what a user gets and why, and any change the agent proposes still goes through your review. For example:

- "Create a wishlist feature starting at 5%"
- "Add an A/B test on the pricing page, 50/50, only in Germany and the Netherlands"
- "Create a checkoutSettings global variable with currency and paymentMethods, with iDEAL for the Netherlands"
- "Add a maintenanceMode kill switch that turns off checkout and its promo banner"
- "Let customers who opt in to early access try the wishlist before everyone else"
- "Give the checkout page one composed value with the flag, the pricing variation and the support email"
- "Why is checkout disabled for user 9b30 in Germany?"
- "Which features use the netherlands segment, and what breaks if I archive it?"
- "Write tests for pricing covering both variations, and a scenario for maintenance mode"
- "Summarize what this branch changes in our flags"
- "Set up a new Featurevisor project with staging and production environments"
- "Turn our staging and production environments into Sets, promoted from staging to production"
- "Wire the checkout feature into my React app, refreshing the datafile every 5 minutes"
- "Upgrade this project from Featurevisor v3 to v4"

## What's included

One skill, `featurevisor`, for Featurevisor v4:

- **Authoring**: features, variations, feature variables, force, attributes and their formats, segments, schemas and mutations, with unified `conditions` (attribute, segment, feature and variable leaves) for every selector and gate. Global variables with nested and accumulating overrides, and compositions with `compose`. Mutually exclusive experiments, environments, Sets and promotions, and `convert` to move a project between them.
- **Verification**: a definition of done the agent follows after every change: `fmt`, `lint`, specs, `evaluate --explain` on representative contexts, `test --uncovered`, and `diff` to summarize the change.
- **Testing**: feature, segment and global variable specs, checks, standalone scenarios, matrices, targets, JSON reports and exact case reruns.
- **Querying**: `list`, `find-usage`, `find-duplicate-segments`, `evaluate --explain`, `assess-distribution` and `diff` for answering questions without reading YAML by hand.
- **Visual review**: the Catalog in watch mode, so changes made by prompt appear in the browser as they are saved.
- **Applications**: the JavaScript SDK in Node.js, browsers, edge runtimes and React Native, React and Vue, typed code generation, SDKs in other languages and their spec runners, and OpenFeature providers.
- **Recipes**: gradual rollouts, A/B and multivariate tests, kill switches, scheduled launches, early access programmes, entitlements, version gates and flag cleanup.
- **Upgrades**: v3 to v4 and v2 to v3, for projects and applications, in an order that keeps them deployable. `migrate` rewrites a v3 project's definitions for v4.
- **Extending**: CLI plugins, the datasource API and custom adapters.
- **Templates**: a starting file for every common shape, and a complete example project that passes lint and test.

## Updating

```bash
npx skills update featurevisor --project
```

Use `--global` for a global installation. Updating the skill does not upgrade your Featurevisor CLI or SDKs.

## Reporting issues

The skill lives in the Featurevisor monorepo: <https://github.com/featurevisor/featurevisor/issues>
