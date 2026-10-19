# Activation tracking (analytics)

Featurevisor decides who sees which variation. It is not an analytics platform. To measure an experiment, connect the SDK's **`modules` API** to the analytics the team already uses, such as GA4 with Tag Manager, Segment, Amplitude, Snowplow or a data warehouse.

Full docs:

- Modules API: [sdk-javascript.md](sdk-javascript.md#modules) and <https://featurevisor.com/docs/sdks/javascript/#modules>
- Google Analytics recipe: <https://featurevisor.com/docs/tracking/google-analytics/>
- Experiments: <https://featurevisor.com/docs/use-cases/experiments/>

## What "activation" means

An **activation** is the first time a user is shown a variation. Record one event per user, feature and variation, at the moment the variation is shown, not on every read. A module sees every evaluation, so it decides which ones count.

## Minimal module

```js
export function createActivationModule({ subjectId, identityAttribute = 'userId', send }) {
  const seen = new Set()

  return {
    name: 'activationTracking',

    afterEvaluation(evaluation, options) {
      // Read the variation the same way getVariation() does: for the common
      // allocated reason the value lives on variation, not variationValue.
      const variationValue = evaluation.variationValue ?? evaluation.variation?.value

      if (
        options.dependencyPurpose !== 'condition' &&
        evaluation.type === 'variation' &&
        ['allocated', 'rule', 'sticky'].includes(evaluation.reason) &&
        typeof variationValue === 'string' &&
        options.context[identityAttribute] === subjectId
      ) {
        const key = JSON.stringify([evaluation.featureKey, variationValue])

        if (!seen.has(key)) {
          seen.add(key)
          send({
            event: 'featurevisor_activation',
            featureKey: evaluation.featureKey,
            variationValue,
          })
        }
      }

      // ALWAYS return the evaluation, on every path.
      return evaluation
    },

    close() {
      seen.clear()
    },
  }
}
```

```js
const f = createFeaturevisor({
  datafile,
  modules: [
    createActivationModule({
      subjectId: currentUser.id,
      send: (payload) => analytics.track(payload.event, payload),
    }),
  ],
})
```

What the shape gets right, each of which fails silently when wrong:

- **Always return `evaluation`, from every branch.** The SDK assigns the callback's return value back to the evaluation. An early `return` with no value makes every flag read as `false` and every variation as `null`, across the whole application, with no error.
- **Do not read `variationValue` alone.** For the normal `allocated` reason it is `undefined` and the value sits on `evaluation.variation.value`.
- **Count only `allocated`, `rule` and `sticky`.** That skips errors, disabled fallbacks and `forced` results, so a QA or stakeholder preview through a force entry never counts in the results.
- **Send once per feature and variation.** Without the `seen` set, every render sends another event. Create the module per user and session, and remove it on sign out or when consent is withdrawn (`await f.removeModule('activationTracking')`). Never share one across users on a server.
- **Skip `dependencyPurpose: 'condition'`.** Those are eligibility reads, such as an experiment checking its allocation feature. Reads with `dependencyPurpose: 'composition'` are values the application consumes and can be real exposures, so do not skip everything that has `dependencyOf`.

Read the variation with `getVariation` when the user actually sees it, not while prefetching, or users are counted before they see anything. Reading only feature variables records nothing with this module, since it listens for variation evaluations.

`afterEvaluation` also receives global variable evaluations ([global-variables.md](global-variables.md)). The `type === 'variation'` guard excludes them. Use `afterEvaluation`: the old `after` callback does not run in v4.

## Google Analytics 4 with Tag Manager

1. In Tag Manager, create a GA4 event tag named `featurevisor_activation`.
2. Register `featureKey` and `variationValue` as custom dimensions, as event parameters or user properties.
3. Fire the tag on a custom event trigger matching the `dataLayer` event, `featurevisorActivation`.
4. Pass a `send` that pushes to the data layer:

```js
send: (payload) =>
  window.dataLayer.push({
    event: 'featurevisorActivation',
    featureKey: payload.featureKey,
    variationValue: payload.variationValue,
  })
```

GA4 event names use underscores, while `dataLayer` events are usually camel case, which is why the two names differ. An engineer adds the module once. The Tag Manager and Analytics steps need no code, so an analyst or marketer can own them.

## Planning and reading results

Help the user decide before the experiment starts which outcome it should move, such as sign ups, and how long it runs. Choosing them afterwards makes any difference easy to find and hard to trust, and an early lead can be chance. Then compare users who saw `control` with those who saw `treatment` on that outcome, in the analytics tool or its warehouse export.

## Authoring side

Tracking is application work. Authoring affects what can be tracked:

- Only features with `variations` produce activations. A plain flag rollout has nothing to compare, so track flag reads directly if the team needs them.
- Feature variables usually need no events of their own: the variation already identifies the cohort.
- Analytics joins on feature keys and variation values. Do not rename either once tracked, or dashboards break.

## When the user asks

- "How do I measure my A/B test?" Point at this file and the experiments recipe in [recipes.md](recipes.md#ab-test).
- "How do I send to another vendor?" Use the same module and change `send`.
- "Is Featurevisor an analytics tool?" No. It assigns variations, and the activation events flow into whatever the team already uses.
