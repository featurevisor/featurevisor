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

## Set up Featurevisor

We will start by creating a new `src/featurevisor.ts` file:

```ts {% path="src/featurevisor.ts" %}
import { createInstance } from '@featurevisor/sdk'

// Replace with your actual datafile URL
const DATAFILE_URL = 'https://cdn.yoursite.com/datafile.json'

const f = createInstance({})
let initialFetchCompleted = false

export function fetchAndSetDatafile() {
  console.log('[Featurevisor] Fetching datafile from:', DATAFILE_URL)

  const result = fetch(DATAFILE_URL)
    .then((response) => response.json())
    .then((datafile) => f.setDatafile(datafile))
    .catch((error) =>
      console.error('[Featurevisor] Error fetching datafile:', error)
    )

  initialFetchCompleted = true

  return result
}

export async function getInstance() {
  if (initialFetchCompleted) {
    return f
  }

  await fetchAndSetDatafile()

  return f
}
```

## Flags SDK integration

Now we can create a new `src/flags.ts` file to integrate with the Flags SDK:

```ts {% path="src/flags.ts" %}
import { flag } from 'flags/next'
import { getInstance } from './featurevisor'

export const exampleFlag = flag({
  key: 'exampleFlag',
  identify: ({ headers, cookies }) => {
    return {
      userId: '123', // Replace with actual user ID
      // ...additional context
    }
  },
  async decide({ entities }) {
    const f = await getInstance()

    const featureKey = 'my_feature' // Replace with your feature key
    const context = {
      userId: entities?.userId, // Use the user ID from the identify function
      // ...additional context if needed
    }

    return f.isEnabled(featureKey, context)
  },
})
```

Learn more in [Context](/docs/sdks/javascript/#context) section.

## App Router

If you're using the App Router, you can call the flag function from a page, component, or middleware to evaluate the flag:

```ts {% path="src/app/page.tsx" %}
import { exampleFlag } from '../flags'

export default async function Page() {
  const example = await exampleFlag()

  return <div>{example ? 'Flag is on' : 'Flag is off'}</div>
}
```

## Pages Router

If you're using the Pages Router, you can call the flag function inside getServerSideProps and pass the values to the page as props:

```ts {% path="src/pages/index.tsx" %}
import type { InferGetServerSidePropsType, GetServerSideProps } from 'next'
import { exampleFlag } from '../flags'

export const getServerSideProps = (async ({ req }) => {
  const example = await exampleFlag(req)

  return {
    props: {
      example
    }
  }
}) satisfies GetServerSideProps<{ example: boolean }>

export default function Page({
  example
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <div>{example ? 'Flag is on' : 'Flag is off'}</div>
}
```

## Refreshing the datafile

If you are using App Router, it is likely you would like to serve your latest Featurevisor project changes to your application without having to redeploy it.

You can either do this by listening to the changes via a custom webhook, or by periodically fetching the datafile in the background:

```ts {% path="src/featurevisor.ts" %}
// ...existing code

const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes

setInterval(async () => {
  await fetchAndSetDatafile()
}, REFRESH_INTERVAL)
```

## Working repository

You can find a fully functional example of this integration on GitHub: [https://github.com/featurevisor/featurevisor-example-nextjs](https://github.com/featurevisor/featurevisor-example-nextjs).
