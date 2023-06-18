---
title: Testing in production (UAT)
description: Learn how to coordinate user acceptance testing (UAT) in production with Featurevisor
ogImage: /img/og/docs-use-cases-testing-in-production.png
---

As your application grows more complex with critical features, you want to have more confidence that everything works as expected in production environment where your real users are, before any new features are  exposed them. Coordinating user acceptance testing (UAT) with Featurevisor can help you there. {% .lead %}

## What is User Acceptance Testing?

User Acceptance Testing (UAT) is a type of testing performed by the end users or the client to verify/accept the software system before moving the software application to the production environment.

UAT is done in the final phase of testing after functional, integration and system testing is done.

## Who performs the testing?

It depends how your team and/or organization is structured.

For small teams, it can be the same team that develops the features. For larger organizations, there can be a dedicated QA (Quality Assurance) team consisting of SDETs (Software Development Engineers in Test).

## Your application

Imagine you own an e-commerce application, where you offer your users the ability to buy products, and leave reviews on products.

One of the teams in your organization is working on a new feature that allows users to add products to their wishlists, and it is controlled by a feature flag called `wishlist`.

## Attributes

Before continuing further with feature flags, let's have our Featurevisor attributes defined for your application.

### `userId`

This attribute will be used to identify the logged in user in the runtime.

```yml
# attributes/userId.yml
description: User ID
type: string
capture: true
```

### `deviceId`

This attribute will be used to identify the device in the runtime, and is going to be the only ID that we can use for targeting anonymous users (those who haven't logged in yet).

```yml
# attributes/deviceId.yml
description: Device ID
type: string
capture: true
```

To learn about what `capture` does, see [Attributes](/docs/attributes) page.

## Feature

We wish to control the `wishlist` feature with a feature flag, so that we can enable it for a subset of our users in the runtime.

```yml
# features/wishlist.yml
description: Wishlist feature for products
tags:
  - all

# because this is only exposed to logged in users
bucketBy: userId

# by default, we want to disable this feature
defaultValue: false

variations:
  - value: true
    weight: 100

  # boolean feature flags don't need any
  # weight distribution for falsy value
  - value: false
    weight: 0

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # everyone
        percentage: 0 # disabled for everyone now
```

We have only one rule so far, which has the feature flag disabled for everyone for now.

We will begin increasing the `percentage` value after we have done some testing in production.

## Letting QA team access the feature

Even though the feature itself is disabled in production for everyone, we still wish our QA team to be able to access it so they can perform their testing and let the feature owning team know about it before they proceed to roll it out for everyone later.

Given the `wishlist` feature is bucketed against `userId` attribute, we need to know the User IDs of all QA team members first. Once that's in hand, those User IDs can be embedded directly targeting an environment of the feature flag.

```yml
# features/wishlist.yml

# ...

environments:
  production:
    # we use the force key to force enable the feature
    # only if certain conditions match
    force:
      - conditions:
          - attribute: userId
            operator: in
            values:
              # the User IDs of QA team members
              - "user-id-1"
              - "user-id-2"
              - "user-id-3"
              - "user-id-4"
              - "user-id-5"
        variation: true
    rules:
      - key: "1"
        segments: "*"
        percentage: 0

```

After you have [built](/docs/building-datafiles) and [deployed](/docs/deployment) your datafiles, the QA team members can access production version of your application with the `wishlist` feature enabled for them, while your regular users still see the feature disabled.

## Making things more maintainable with segments

The above approach works, but it can be a bit cumbersome to maintain as the number of QA team members grow and also when their responsibility for testing grows beyond just one feature at a time.

We can make things more maintainable by creating a new `qa` segment:

```yml
# segments/qa.yml
description: QA team members
conditions:
  - attribute: userId
    operator: in
    values:
      # the User IDs of QA team members
      - "user-id-1"
      - "user-id-2"
      - "user-id-3"
      - "user-id-4"
      - "user-id-5"
```

And then use it in the `wishlist` feature flag:

```yml
# features/wishlist.yml

# ...

environments:
  production:
    force:
      - segments:
          - qa
        variation: true
    rules:
      - key: "1"
        segments: "*"
        percentage: 0
```

## Evaluating the features with SDKs

Now that the QA team members can access the feature, we need to make sure that the feature is evaluated correctly in the runtime.

Initialize the SDK first:

```js
import { createInstance } from '@featurevisor/sdk";

const sdk = createInstance({
  datafileUrl: "https://cdn.yoursite.com/datafile.json",
});
```

Evaluate with the right attributes:

```js
const isWishlistEnabled = sdk.getVariation("wishlist", {
  userId: "user-id-1",
  deviceId: "device-id-1",
});

if (isWishlistEnabled) {
  // render the wishlist feature
}
```

## Anonymous users

Not all features are only exposed to logged in users. Some features are exposed to anonymous users as well. Think of a new feature that is only available in the landing page of your application, and you want to expose it to all users, regardless of whether they are logged in or not.

For those cases, we can rely on the `deviceId` value, which can be generated (can be an UUID) and persisted in the client-side. For browsers, this value can be generated and stored in localStorage for example.

Once we know those values, all we have to do is go and update the `qa` segment only:

```yml
# segments/qa.yml
description: QA team members
conditions:
  or:
    # the User IDs of QA team members
    - attribute: userId
      operator: in
      values:
        - "user-id-1"
        - "user-id-2"
        - "user-id-3"
        - "user-id-4"
        - "user-id-5"

    # the Device IDs of QA team members
    - attribute: deviceId
      operator: in
      values:
        - "device-id-1"
        - "device-id-2"
        - "device-id-3"
        - "device-id-4"
        - "device-id-5"
```

We turned our original condition in the segment to an `or` condition, and added the `deviceId` condition to it. This way, whenever any of the conditions match, we will consider the user as a QA team member.

## Gradual rollout

Once the QA team has verified that the feature works as expected, we can begin rolling it out to a small percentage of our users in the runtime.

```yml
# features/wishlist.yml

# ...

environments:
  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 5 # 5% of the traffic
```

As we gain more confidence, we can increase the `percentage` value gradually all the way up to `100`.

## Conclusion

We have just learned how to coordinate user acceptance testing (UAT) in your organization with Featurevisor, where we can expose features to a subset of users in production environment, and how to evaluate those features with SDKs.

All done while maintaining a single source of truth for managing the QA segment, and without having to deploy any code changes to your application.

Featurevisor is smart enough to not include any segment (like `qa`) in generated datafiles that is not being used in any of the feature flags, so you don't have to worry about your datafile size growing unnecessarily.
