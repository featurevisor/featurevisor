# Activation tracking (analytics)

Featurevisor itself is not an analytics platform. To measure experiments you wire the SDK's **`modules` API** to your existing analytics pipeline (GA4 + GTM, Segment, Amplitude, Snowplow, your own warehouse, etc.).

Full docs:

- Modules API: [sdk-javascript.md](sdk-javascript.md#modules) and <https://featurevisor.com/docs/sdks/javascript>
- GTM / GA4 recipe: <https://featurevisor.com/docs/tracking/google-analytics>

## What "activation" means

When a user is evaluated as bucketed into a variation, that's an **activation**. The module runs after each evaluation; you decide what to push downstream.

## Minimal module (vendor-agnostic)

```js
import { createFeaturevisor } from '@featurevisor/sdk'

const f = createFeaturevisor({
  datafile,

  modules: [
    {
      name: 'analyticsActivation',

      afterEvaluation: function (evaluation) {
        // Read the variation the same way getVariation() does: for the common
        // `allocated` reason the value lives on `variation`, not `variationValue`.
        const variationValue =
          evaluation.variationValue ?? evaluation.variation?.value

        if (
          evaluation.reason !== 'error' &&
          evaluation.type === 'variation' &&
          typeof variationValue === 'string'
        ) {
          const { userId } = f.getContext()

          // hand off to your analytics
          yourAnalytics.track('featurevisor_activation', {
            featureKey: evaluation.featureKey,
            variationValue,
            userId,
          })
        }

        // ALWAYS return the evaluation, on every path.
        return evaluation
      },
    },
  ],
})
```

Two things in that shape are load-bearing, and both fail silently if you get them wrong:

- **Always return `evaluation`, from every branch.** The SDK assigns the callback's return value back to the evaluation. An early `return` with no value makes every flag read as `false` and every variation as `null`, across the whole application, with no error.
- **Do not read `variationValue` alone.** For the normal `allocated` reason it is `undefined` and the value sits on `evaluation.variation.value`. Reading only `variationValue` sends `undefined` to analytics for exactly the A/B tests you are trying to measure.

`afterEvaluation` also receives **global variable** evaluations ([global-variables.md](global-variables.md)). The `type === 'variation'` guard above already excludes them. If a module should act only on global variables, branch on a variable evaluation that has no `featureKey`.

Modules written against the older `after` callback still run, but only for feature evaluations, and that callback is deprecated. Use `afterEvaluation` in new code.

## Google Analytics 4 + GTM (canonical recipe)

1. In GTM, create a GA4 Event tag with event name `featurevisor_activation`.
2. Register `featureKey` and `variationValue` as Event Parameters (or User Properties, your call).
3. Trigger the tag on a Custom Event matching the `dataLayer` event name (`featurevisorActivation`, camelCase).
4. Use the module above, swapping `yourAnalytics.track(...)` for:

```js
window.dataLayer.push({
  event: 'featurevisorActivation',
  featureKey: evaluation.featureKey,
  variationValue,
  userId,
})
```

The `return evaluation` at the end of the callback still applies. Swapping the analytics call does not change that requirement.

Convention from the docs: snake_case for GA4 event names, camelCase for the `dataLayer` event name.

## Authoring side

Tracking is application-side. Authoring affects what _can_ be tracked:

- Only variation evaluations fire meaningfully for experiments. If the user is running a simple boolean rollout (no `variations:`), there's nothing experiment-shaped to activate — track flag evaluations directly if needed.
- Variable evaluations don't generally need their own activation events; the variation evaluation already represents the bucketed cohort.
- Stable feature/variation **keys** are what analytics joins on. Reinforce: don't rename rule keys, don't rename variation values once tracked. Renames invalidate dashboards.

## When the user asks

- "How do I measure my A/B test?" → point at this file + the experiments recipe in [recipes.md](recipes.md).
- "How do I send to <vendor>?" → vendor-agnostic shape above; the module runs, you bridge.
- "Is Featurevisor an analytics tool?" → no, it's a feature-management tool. Activation events flow into whatever you already use.
