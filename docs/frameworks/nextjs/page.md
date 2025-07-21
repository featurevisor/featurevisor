---
title: Next.js
nextjs:
  metadata:
    title: Next.js
    description: Learn how to integrate Featurevisor in Next.js applications for evaluating feature flags
    openGraph:
      title: Next.js
      description: Learn how to integrate Featurevisor in Next.js applications for evaluating feature flags
      images:
        - url: /img/og/docs-frameworks-nextjs.png
---

Set up Featurevisor SDK in an existing Next.js application for evaluating feature flags covering both Pages Router and App Router. {% .lead %}

## Flags SDK

Vercel has created [Flags SDK](https://flags-sdk.dev/frameworks/next), which works very well with [Next.js](https://nextjs.org/) applications.

We don't necessarily need this additional layer to use Featurevisor, but this guide will show you how you can use them together giving you the flexibility to migrate from other feature management tools to Featurevisor and vice versa with ease.

## Installation

In your existing Next.js application:

```{% title="Command" %}
$ npm install --save flags @featurevisor/sdk
```

## Naming conventions

Because Featurevisor allows evaluating 3 different types of values against individual features, we need to establish a naming convention for the keys used in the Flags SDK:

| Evaluation type | Value type | Key Format                   | Example                  |
| --------------- | ---------- | ---------------------------- | ------------------------ |
| Flag            | boolean    | `<featureKey>`               | `my_feature`             |
| Variation       | string     | `<featureKey>:variation`     | `my_feature:variation`   |
| Variable        | mixed      | `<featureKey>:<variableKey>` | `my_feature:my_variable` |

## Set up Featurevisor

We will start by creating a new Featurevisor adapter using Flags SDK in the `src/featurevisor.ts` file:

```ts {% path="src/featurevisor.ts" %}
import type { Adapter } from 'flags'
import { createInstance, FeaturevisorInstance } from '@featurevisor/sdk'

export interface FeaturevisorAdapterOptions {
  datafileUrl: string
  refreshInterval?: number
  f?: FeaturevisorInstance
}

export interface FeaturevisorEntitiesType {
  userId?: string
  // ...add more properties (attributes) for your context here
}

export function createFeaturevisorAdapter(options: FeaturevisorAdapterOptions) {
  const f = options.f || createInstance({})
  let initialFetchCompleted = false

  // datafile fetcher
  function fetchAndSetDatafile() {
    console.log('[Featurevisor] Fetching datafile from:', options.datafileUrl)

    const result = fetch(options.datafileUrl)
      .then((response) => response.json())
      .then((datafile) => {
        f.setDatafile(datafile)
        initialFetchCompleted = true
      })
      .catch((error) =>
        console.error('[Featurevisor] Error fetching datafile:', error)
      )

    return result
  }

  // datafile refresher (periodic update)
  if (options.refreshInterval) {
    setInterval(async () => {
      await fetchAndSetDatafile()
    }, options.refreshInterval)
  }

  // adapter
  return function featurevisorAdapter<
    ValueType,
    EntitiesType extends FeaturevisorEntitiesType
  >(): Adapter<ValueType, EntitiesType> {
    return {
      async decide({ key, entities, headers, cookies }): Promise<ValueType> {
        // ensure the datafile is fetched before making decisions
        if (!initialFetchCompleted) {
          await fetchAndSetDatafile()
        }

        const context = {
          userId: entities?.userId,
        }

        // mapping passed key to Featurevisor SDK methods:
        //
        //   - '<featureKey>'               => f.isEnabled(key, context)
        //   - '<featureKey>:variation'     => f.getVariation(key, context)
        //   - '<featureKey>:<variableKey>' => f.getVariable(key, variableKey, context)
        const [featureKey, variableKey] = key.split(':')

        if (variableKey) {
          if (variableKey === 'variation') {
            // variation
            return f.getVariation(featureKey, context) as ValueType
          } else {
            // variable
            return f.getVariable(featureKey, variableKey, context) as ValueType
          }
        }

        // flag
        return f.isEnabled(featureKey, context) as ValueType
      },
    }
  }
}
```

## Flags SDK integration

Now we can create a new `src/flags.ts` file for our individual features and their evaluations:

```ts {% path="src/flags.ts" %}
import { flag } from 'flags/next'
import { createFeaturevisorAdapter } from './featurevisor'

// set up adapter
const featurevisorAdapter = createFeaturevisorAdapter({
  // replace with your Featurevisor project datafile URL
  datafileUrl: 'https://cdn.yoursite.com/datafile.json',

  // if you want to periodically refresh the datafile
  refreshInterval: 5 * 60 * 1000, // every 5 minutes
})

// feature specific flags
export const myFeatureFlag = flag({
  // '<featureKey>' as the feature key alone to get its flag (boolean) status
  key: 'my_feature',
  adapter: featurevisorAdapter(),
})

export const myFeatureVariation = flag({
  // '<featureKey>:variation' is to get the variation (string) of the feature
  key: 'my_feature:variation',
  adapter: featurevisorAdapter(),
})

export const myFeatureVariable = flag({
  // '<featureKey>:<variableKey>' is to get the variable value of the feature
  key: 'my_feature:variableKeyHere',
  adapter: featurevisorAdapter(),
})
```

## App Router

If you're using the App Router, you can call the flag function from a page, component, or middleware to evaluate the flag:

```ts {% path="src/app/page.tsx" %}
import { myFeatureFlag } from '../flags'

export default async function Page() {
  const myFeature = await myFeatureFlag()

  return <div>{myFeature ? 'Flag is on' : 'Flag is off'}</div>
}
```

## Pages Router

If you're using the Pages Router, you can call the flag function inside getServerSideProps and pass the values to the page as props:

```ts {% path="src/pages/index.tsx" %}
import type { InferGetServerSidePropsType, GetServerSideProps } from 'next'
import { myFeatureFlag } from '../flags'

export const getServerSideProps = (async ({ req }) => {
  const myFeature = await myFeatureFlag(req)

  return {
    props: {
      myFeature
    }
  }
}) satisfies GetServerSideProps<{ myFeature: boolean }>

export default function Page({
  myFeature
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <div>{myFeature ? 'Flag is on' : 'Flag is off'}</div>
}
```

## Working repository

You can find a fully functional example of this integration on GitHub: [https://github.com/featurevisor/featurevisor-example-nextjs](https://github.com/featurevisor/featurevisor-example-nextjs).
