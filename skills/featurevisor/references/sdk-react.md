# React

Full docs: <https://featurevisor.com/docs/react/>. React Native: <https://featurevisor.com/docs/react-native/>

`@featurevisor/react` wraps the [JavaScript SDK](sdk-javascript.md) with a provider and hooks. Instance creation, context, datafile refresh and events work as described there.

```bash
npm install --save @featurevisor/sdk @featurevisor/react
```

## Provider

Create the instance once, outside the component tree:

```jsx
import { createFeaturevisor } from '@featurevisor/sdk'
import { FeaturevisorProvider } from '@featurevisor/react'

const response = await fetch(DATAFILE_URL)

const f = createFeaturevisor({
  datafile: await response.json(),
  context: { userId: '8f2a' },
})

root.render(
  <FeaturevisorProvider instance={f}>
    <App />
  </FeaturevisorProvider>,
)
```

## Hooks

```jsx
import { useFlag, useVariation, useVariable } from '@featurevisor/react'

function Checkout() {
  const enabled = useFlag('checkout')
  const variation = useVariation('pricing') // string or null
  const label = useVariable('buyButton', 'label')
  const supportEmail = useVariable('supportEmail') // global variable

  if (!enabled) return <OldCheckout />

  return <NewCheckout variation={variation} label={label} support={supportEmail} />
}
```

These hooks render again when their **evaluated value** changes after a datafile update, a context change or new sticky values, including changes through segments, conditions and compositions. Unrelated updates and unchanged values do not render again.

Each hook takes an optional context as its last argument: `useFlag('checkout', { country: 'nl' })`. Memoize that object with `useMemo`, because a new object on every render re-subscribes every time.

## Without re-rendering

```jsx
import { useFeaturevisor, useSdk } from '@featurevisor/react'

function SignIn() {
  const { setContext, isEnabled } = useFeaturevisor() // bound methods
  const f = useSdk() // the raw instance
}
```

These do **not** re-render on changes. Use them in event handlers, for example `setContext({ userId })` after sign in, not for render time branching. `onFeatureChange(sdk, featureKey, callback)` and `onVariableChange(sdk, variableKey, callback)` subscribe outside hooks.

## Server rendering

Evaluating separately on server and client can disagree and cause hydration mismatches or flicker. Evaluate once per request on the server with a child instance, serialize `getFeatureEvaluations()` and `getVariableEvaluations()` into the page, and start the client instance with them as `stickyFeatures` and `stickyVariables` ([SSR handoff](sdk-javascript.md#ssr-handoff)). See the [Next.js guide](https://featurevisor.com/docs/frameworks/nextjs/).

## Guidance

- Typed hooks with checked keys come from `generate-code --react` ([code-generation.md](code-generation.md)).
- React Native uses the same package. Create the instance at module scope, fetch the datafile in a root `useEffect`, call `setDatafile(datafile, true)`, and render once loading settles.
- Example app: <https://github.com/featurevisor/featurevisor-example-react>
