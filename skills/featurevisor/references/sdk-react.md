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
if (!response.ok) throw new Error(`HTTP ${response.status}`)

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

Outside the provider, every hook except `useSdk` throws "Featurevisor SDK is not available", and `useSdk` returns `undefined`. That error means missing wiring, not a missing feature.

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

### Several features at once

```jsx
import { useFlags, useEveryFlag, useSomeFlag } from '@featurevisor/react'

function Header() {
  const [checkout, liveChat] = useFlags(['checkout', 'liveChat'])
  const savedForCheckout = useEveryFlag(['checkout', 'wishlist'])
  const showHelp = useSomeFlag(['liveChat', 'wishlist'])
}
```

- `useFlags(keys)` returns one boolean per key, in order. The list can have any length and can be built while rendering, since the subscription follows the keys, not the array. An inline list types as an exact tuple, a runtime list as `readonly boolean[]`. The array keeps its identity while the values stay the same, so it can go in effect dependencies. A missing feature is `false`, and a repeated key is evaluated once.
- `useEveryFlag(keys)` and `useSomeFlag(keys)` return one boolean. They stop at the first disabled or enabled flag, so a module does not see the flags after it. Like `every` and `some`, an empty list gives `true` and `false`. An inline `[]` is a type error.
- In a long list, call `useFlags` once in the parent and pass the values down, rather than `useFlag` in every row.
- A rule that one feature must never be on without another belongs in the feature's root `conditions` ([features.md](features.md#root-conditions)), not in `useEveryFlag`, so every application agrees.

### Revision

```jsx
import { useRevision } from '@featurevisor/react'

function Footer() {
  const revision = useRevision()

  return <small>Datafile revision {revision}</small>
}
```

`useRevision()` returns the datafile revision and renders again only when a datafile with another revision arrives. Before any datafile it is `unknown`.

There is no hook for a snapshot of several features. For a debugging panel, call `getFeatureEvaluations(context, keys)` on `useSdk()` ([sdk-javascript.md](sdk-javascript.md)) in a component that also calls `useRevision()`, so it reads again after each new revision. It returns an object keyed by feature key, evaluates every variable of every listed feature, and reads each listed feature's variation, which an [activation module](tracking.md) counts as shown. Keep it out of what users see.

### Context for part of the tree

```jsx
import { FeaturevisorScope } from '@featurevisor/react'

// A product page adds the product it shows.
function ProductPage({ product }) {
  return (
    <FeaturevisorScope context={{ productId: product.id }}>
      <ProductReviews />
    </FeaturevisorScope>
  )
}

// A category page sets the category once, and each card adds its product.
function CategoryPage({ category, products }) {
  return (
    <FeaturevisorScope context={{ category: category.key }}>
      {products.map((product) => (
        <FeaturevisorScope key={product.id} context={{ productId: product.id }}>
          <ProductCard product={product} />
        </FeaturevisorScope>
      ))}
    </FeaturevisorScope>
  )
}
```

- Every evaluating hook below a `FeaturevisorScope` reads its context. Each read merges, lowest first: the instance context, each enclosing scope from the outermost, and the hook's own context argument. The merge is shallow, and scopes nest: an inner scope keeps the keys it sets when the outer one changes them and follows it for the rest, and sibling scopes stay apart.
- `useFeaturevisor` reads (`isEnabled`, `getVariation`, every `getVariable` form, `getContext`) include the scope. Its `setContext` and sticky setters still change the instance. `useSdk` and `useRevision` are unchanged, and a nested `FeaturevisorProvider` starts without the scope.
- The order is by position, not by time: instance context changes apply inside a scope only for keys it does not set, and an inner scope keeps its keys over an outer one. Sticky values sit outside the merge and still win inside a scope. `useFeaturevisor().getContext()` inside a scope shows the merged context. A scope follows its `context` prop: when the values change, every hook below renders again with them, in the same render, and components that read no feature or variable are not rendered by it. Change it with state or props, not by mutating an object in place. A context with the same values, nested objects, arrays and dates included, renders nothing below again.
- Reach for it when part of the page knows something the instance context does not: which product, category or other item it shows, so feature conditions can target it, which microfrontend it is when several share one instance, or, in a support tool, which customer it is about. On a client one person sees the whole page, so do not use scopes to preview that person on other plans.
- In the Next.js App Router, a server component such as a page can render `FeaturevisorScope` around client components, with a context of plain values. `FeaturevisorProvider` needs a client component, because a server component cannot pass it an instance.
- Keep `userId` out of a scope unless that part is about another user, because it changes bucketing. Tracking modules see the merged context, so they can tell which product an exposure came from.

### When components render again

A hook that reads a feature or variable renders its component again when:

- a datafile update names its key, or any key in its list. The SDK includes keys whose conditions depend on a changed segment, feature or variable, so unrelated updates are ignored.
- the instance context changes, through `setContext`
- sticky values change

Context and sticky changes re-render every component that uses such a hook, even when its value stays the same. Each hook also evaluates on every render, and StrictMode renders twice in development, so tracking modules must deduplicate ([tracking.md](tracking.md)).

Every hook that reads a feature or variable takes an optional context as its last argument: `useFlag('checkout', { country: 'nl' })`. It is read on each render and is not part of the subscription, so it needs no memoizing.

## Without re-rendering

```jsx
import { useFeaturevisor, useSdk } from '@featurevisor/react'

function SignIn() {
  const { setContext, isEnabled } = useFeaturevisor() // bound methods
  const f = useSdk() // the raw instance
}
```

These do **not** re-render on changes. Use them in event handlers, for example `setContext({ userId })` after sign in, not for render time branching. `useSdk` also covers what `useFeaturevisor` lacks, such as `setDatafile` in a refresh effect. `onFeatureChange(sdk, featureKey, callback)`, `onFeaturesChange(sdk, featureKeys, callback)` and `onVariableChange(sdk, variableKey, callback)` subscribe outside hooks, and each returns an unsubscribe function.

## Server rendering

Evaluating separately on server and client can disagree and cause hydration mismatches or flicker. Evaluate once per request on the server with a child instance, serialize `getFeatureEvaluations()` and `getVariableEvaluations()` into the page, and start the client instance with them as `stickyFeatures` and `stickyVariables` ([SSR handoff](sdk-javascript.md#ssr-handoff)). See the [Next.js guide](https://featurevisor.com/docs/frameworks/nextjs/).

## Guidance

- Typed hooks with checked keys come from `generate-code --react` ([code-generation.md](code-generation.md)).
- `useFlags`, `useEveryFlag`, `useSomeFlag`, `useRevision`, `onFeaturesChange` and `FeaturevisorScope` need a `@featurevisor/react` release that exports them. Check the installed package (`npm ls @featurevisor/react` and its type definitions) before using them, and otherwise call `useFlag` per key or propose upgrading.
- React Native uses the same package. Create the instance at module scope, fetch the datafile in a root `useEffect`, call `setDatafile(datafile, true)`, and render once loading settles.
- Example app: <https://github.com/featurevisor/featurevisor-example-react>
