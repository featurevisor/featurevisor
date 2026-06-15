# Activation tracking (analytics)

Featurevisor itself is not an analytics platform. To measure experiments you wire the SDK's **`hooks` API** to your existing analytics pipeline (GA4 + GTM, Segment, Amplitude, Snowplow, your own warehouse, etc.).

Full docs:

- Hooks API: <https://featurevisor.com/docs/sdks/javascript> (search "hooks")
- GTM / GA4 recipe: <https://featurevisor.com/docs/tracking/google-analytics>

## What "activation" means

When a user is evaluated as bucketed into a variation, that's an **activation**. The hook fires after each evaluation; you decide what to push downstream.

## Minimal hook (vendor-agnostic)

```js
import { createFeaturevisor } from '@featurevisor/sdk'

const f = createFeaturevisor({
  datafile,

  hooks: [
    {
      name: 'analyticsActivation',

      after: function (evaluation) {
        const { reason, type, featureKey, variationValue } = evaluation

        if (reason === 'error') return
        if (type !== 'variation') return        // only track variation evaluations

        const feature = f.getFeature(featureKey)
        if (!feature || !feature.variations) return

        const { userId } = f.getContext()

        // hand off to your analytics
        yourAnalytics.track('featurevisor_activation', {
          featureKey,
          variationValue,
          userId,
        })
      },
    },
  ],
})
```

## Google Analytics 4 + GTM (canonical recipe)

1. In GTM, create a GA4 Event tag with event name `featurevisor_activation`.
2. Register `featureKey` and `variationValue` as Event Parameters (or User Properties, your call).
3. Trigger the tag on a Custom Event matching the `dataLayer` event name (`featurevisorActivation`, camelCase).
4. Use the hook above, swapping `yourAnalytics.track(...)` for:

```js
window.dataLayer.push({
  event: 'featurevisorActivation',
  featureKey,
  variationValue,
  userId,
})
```

Convention from the docs: snake_case for GA4 event names, camelCase for the `dataLayer` event name.

## Authoring side

Tracking is application-side. Authoring affects what _can_ be tracked:

- Only variation evaluations fire meaningfully for experiments. If the user is running a simple boolean rollout (no `variations:`), there's nothing experiment-shaped to activate — track flag evaluations directly if needed.
- Variable evaluations don't generally need their own activation events; the variation evaluation already represents the bucketed cohort.
- Stable feature/variation **keys** are what analytics joins on. Reinforce: don't rename rule keys, don't rename variation values once tracked. Renames invalidate dashboards.

## When the user asks

- "How do I measure my A/B test?" → point at this file + the experiments recipe in [recipes.md](recipes.md).
- "How do I send to <vendor>?" → vendor-agnostic shape above; the hook fires, you bridge.
- "Is Featurevisor an analytics tool?" → no, it's a feature-management tool. Activation events flow into whatever you already use.
