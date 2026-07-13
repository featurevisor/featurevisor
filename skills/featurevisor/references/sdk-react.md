# React SDK

Full docs: <https://featurevisor.com/docs/react> · React Native: <https://featurevisor.com/docs/react-native>

`@featurevisor/react` wraps the [JavaScript SDK](sdk-javascript.md) with a provider and reactive hooks. Read sdk-javascript.md first for instance creation, context, datafile refresh, and events — this package only adds the React layer.

```bash
npm install --save @featurevisor/react
```

## Provider setup

Create the SDK instance once, outside the component tree, and pass it to `FeaturevisorProvider`:

```jsx
import { createFeaturevisor } from '@featurevisor/sdk'
import { FeaturevisorProvider } from '@featurevisor/react'

const datafile = await fetch(DATAFILE_URL).then((res) => res.json())

const f = createFeaturevisor({ datafile })
f.setContext({ userId: '123' })

root.render(
  <FeaturevisorProvider instance={f}>
    <App />
  </FeaturevisorProvider>,
)
```

## Reactive hooks

These re-render the component when the evaluated **value changes** (new datafile, context update, or sticky update — no re-render if the value is unchanged):

```jsx
import { useFlag, useVariation, useVariable } from '@featurevisor/react'

function Checkout() {
  const isEnabled = useFlag('checkout')
  const variation = useVariation('checkout')            // string | null
  const methods = useVariable('checkout', 'paymentMethods')

  if (!isEnabled) return <OldCheckout />
  return variation === 'treatment' ? <NewCheckout methods={methods} /> : <OldCheckout />
}
```

All three accept optional component-level context as the last argument: `useFlag('checkout', { country: 'nl' })`. Beware of passing a fresh object literal on every render — memoize the context object (`useMemo`) or the hooks' effect re-runs each render.

## Non-reactive access

```jsx
import { useFeaturevisor, useSdk } from '@featurevisor/react'

function MyComponent() {
  // bound methods (isEnabled, getVariation, getVariable*, setContext, setSticky, …)
  const { isEnabled, setContext } = useFeaturevisor()

  // or the raw instance
  const f = useSdk()
}
```

These do **not** trigger re-renders on datafile/context changes — use them for event handlers (e.g. call `setContext` after login) or one-shot reads, not for render-time branching.

`onFeatureChange(sdk, featureKey, callback)` is also exported for custom subscriptions outside hooks.

## Guidance

- Evaluations are cheap but not free; for hot components memoize derived values rather than calling hooks in tight loops.
- Typed hooks (compile-time-checked feature/variable keys) can be generated from the project with `generate-code --react` — see [code-generation.md](code-generation.md).
- **React Native** uses the same `@featurevisor/react` package and hooks; only datafile fetching/caching strategy differs (see the React Native docs link above).
- Example app: <https://github.com/featurevisor/featurevisor-example-react>
