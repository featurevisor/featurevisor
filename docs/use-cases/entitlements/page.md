---
title: User entitlements
nextjs:
  metadata:
    title: User entitlements
    description: Learn how to manage user entitlements using Featurevisor
    openGraph:
      title: User entitlements
      description: Learn how to manage user entitlements using Featurevisor
      images:
        - url: /img/og/docs-use-cases-entitlements.png
---

As your application grows in number of features, it can lead you to offer your services via different plans to your users. Where each plan can come with its own set of entitlements (activities that users are allowed to perform, aka permissions). {% .lead %}

## Your application

Imagine you own a social media application, where you offer your users the ability to create posts, like posts, and comment on posts.

Users can sign up for free and start liking and commenting on others' posts. But to be able to create new posts themselves, they have to buy a premium plan.

## Mapping entitlements against plans

We can map out the entitlements of your users (what they can do) against the different plans you intend to offer as follows:

| Entitlement      | Free Plan | Premium Plan (paid) |
| ---------------- | --------- | ------------------- |
| Like Posts       | ✅        | ✅                  |
| Comment on Posts | ✅        | ✅                  |
| Create Posts     | ❌        | ✅                  |

## User Profile service

For the sake of this guide, let's assume you already have a User Profile service, that allows your application to know in the runtime what plan the currently logged in user is on.

Response of the said User Profile service can be like this:

```js
// GET /profile

{
  "id": "<UUID-here>",
  "name": "Erlich Bachman",
  "plan": "premium", // or `free`
  "country": "us"
}
```

## Attributes

Let's start defining our Featurevisor attributes for your application.

We will use them throughout this guide at various stages.

### `userId`

This attribute will be used to identify the user in the runtime. The `id` field from the response of the User Profile service will be used for this purpose.

```yml {% path="attributes/userId.yml" %}
description: User ID
type: string
```

### `country`

This attribute will be used to identify the country of the user in the runtime. The `country` field from the response of the User Profile service will be used for this purpose.

```yml {% path="attributes/country.yml" %}
description: Country codes in lowercase like us, nl, de, etc.
type: string
```

## Feature

We will be creating a new feature called `plan` that will be used to control the entitlements of your users against various different plans.

```yml {% path="features/plan.yml" %}
description: Plans and their entitlements against known User
tags:
  - all

bucketBy: userId

# we define a variable called `entitlements`,
# that will be an array of strings
variablesSchema:
  entitlements:
    type: array
    defaultValue:
      - likePosts
      - commentOnPosts

# we aren't running an experiment here,
# and will rely on sticky features for users,
# therefore weight distribution of variations are not relevant
variations:
  - value: free
    weight: 100

  - value: premium
    weight: 0
    variables:
      entitlements:
        - likePosts
        - commentOnPosts
        - createPosts # extra entitlement for premium users only

# this is a core application config,
# and is recommended to be rolled out to 100% of the traffic
rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

## Evaluating entitlements with SDKs

Now that we have defined our feature, we can use Featurevisor SDKs to evaluate the entitlements of your users in the runtime.

First, initialize the SDK:

```js {% path="your-app/index.js" %}
import { createInstance } from '@featurevisor/sdk'

const DATAFILE_URL = 'https://cdn.yoursite.com/datafile.json'

const datafileContent = await fetch(DATAFILE_URL)
  .then((res) => res.json())

const f = createInstance({
  datafile: datafileContent,
})
```

Fetch your User's ID and Plan info from your User Profile service and make it available:

```js
const userProfile = await fetch('https://api.yoursite.com/profile')
  .then((res) => res.json())
```

Set sticky features in the SDK for known user:

```js
// we want our known user to be always bucketed
// into the same plan (variation) as User Profile service suggests
f.setSticky({
  plan: {
    enabled: true,
    variation: userProfile.plan,
  },
})
```

Get available entitlements for the known user:

```js
const featureKey = 'plan'
const variableKey = 'entitlements'
const context = {
  userId: userProfile.id,
  country: userProfile.country,
}

const entitlements = f.getVariable(featureKey, variableKey, context)
```

The `entitlements` variable will contain an array of all entitlements the user should have against their current plan.

```js
const canCreatePosts = entitlements.includes('createPosts')
const canLikePosts = entitlements.includes('likePosts')
const canCommentOnPosts = entitlements.includes('commentOnPosts')
```

## Managing entitlements in one place

As your entitlements and number of plans grow, you can use Featurevisor to manage them all declaratively in one place.

Your custom User Profile service only needs to be aware of the plan of the user, and nothing more unless you have any custom user specific overrides.

Since Featurevisor JavaScript SDK is universal and works in both Node.js and browser environments, you can use it to evaluate your users' entitlements in your backend as well as in frontend.

{% callout type="note" title="Always verify in backend" %}
Please note that entitlements check in frontend is never a substitute for backend checks. You should always check entitlements in your backend before performing any action.
{% /callout %}

## User overrides

It is possible in specific circumstances, that you may want to override the entitlements of a user irrespective of what plan they are on.

For example, if a user is on a free plan, but you want to give them access to create posts for free for a limited time.

We can expect our User Profile service to optionally provide the override information given this is about a specific individual user:

```js
// GET /profile

{
  "id": "<UUID-here>",
  "plan": "free",
  "country": "us",

  // optional field for overrides
  "overrideEntitlements": [
    "likePosts",
    "commentOnPosts",
    "createPosts"
  ]
}
```

We can then use the `overrideEntitlements` field from User Profile and set it as a sticky feature in Featurevisor SDK:

```js
f.setStickyFeatures({
  plan: {
    enabled: true,
    variation: userProfile.plan,
    variables: userProfile.overrideEntitlements
      ? // user overrides
        { entitlements: userProfile.overrideEntitlements }
      : // otherwise leave empty
        {},
  },
})
```

You can now continue evaluating entitlements as before using the SDK, and the user will have the overridden entitlements.

## Conditional entitlements

It is possible that you may want to offer a specific entitlement to your users based on their location. We aren't talking about running experiments here targeting one specific country, but more like an entitlement that can only ever be available in one single country only.

For the sake of this guide, let's assume your social media app can legally allow your users to upload videos in the US only in `premium` plan, and nowhere else.

We can declare that config in our feature's definition as follows:

```yml {% path="features/plan.yml" %}
# ...

variations:
  - value: free
    weight: 100

  - value: premium
    weight: 0

    variables:
      entitlements:
        - likePosts
        - commentOnPosts
        - createPosts

    variableOverrides:
      entitlements:
        - conditions:
            - attribute: country
              operator: equals
              value: us
          value:
            - likePosts
            - commentOnPosts
            - createPosts
            - uploadVideos # for US users only

# ...
```

The entitlements array may look repetitive here, but you can also take an approach of breaking down your entitlements into multiple variables instead of one as you see fit.

## Separate variables per entitlement

If you do not wish to have a single variable for all entitlements, you can break them down into multiple variables as follows:

```yml {% path="features/plan.yml" %}
description: Plans and their entitlements against known User
tags:
  - all

bucketBy: userId

variablesSchema:
  canLikePosts:
    type: boolean
    defaultValue: true

  canCommentOnPosts:
    type: boolean
    defaultValue: true

  canCreatePosts:
    type: boolean
    defaultValue: false

  canUploadVideos:
    type: boolean
    defaultValue: false

variations:
  - value: free
    weight: 100

  - value: premium
    weight: 0

    variables:
      canCreatePosts: true
      canUploadVideos: false

    variableOverrides:
      canUploadVideos:
        - conditions:
            - attribute: country
              operator: equals
              value: us
          value: true

rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

This will then require you to evaluate each entitlement separately in your application code using Featurevisor SDKs:

```js
const canCreatePosts = f.getVariable('plan', 'canCreatePosts', context)

if (canCreatePosts) {
  // show create post button
}
```

## Conclusion

When your application and its architecture grows big, and you have multiple teams working and shipping in a distributed fashion, it can become hard to manage entitlements in one place.

Having them declared in one place as a single source of truth can help you manage them better, and also help you avoid any accidental entitlements leaks.
