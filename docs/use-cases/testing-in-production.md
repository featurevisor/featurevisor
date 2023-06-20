---
title: Testing in production
description: Learn how to coordinate testing in production with Featurevisor
ogImage: /img/og/docs-use-cases-testing-in-production.png
---

As your application grows more complex with critical features, you want to have more confidence that everything works as expected in production environment where your real users are, before any new features are  exposed to them. Featurevisor can help coordinating testing in production here. {% .lead %}

## Why test in production?

Testing in production is important because it is the only way to know for sure that your application behaves as expected in the real world, where your real users are. As much as we have a staging environment that mimics the production environment, it is still not the real thing.

It is also the only way to know for sure that your application can handle the real traffic. For this guide here though, we are focusing primarily on the application behavior.

## Who performs the testing?

It depends how your team and/or organization is structured.

- **Manual**: For small teams, it can be the same team that develops the features. For larger organizations, there can be a dedicated QA (Quality Assurance) team that takes care of manually testing the flows in production.
- **Automated**: It can also be automated, where a suite of integration tests are run against the production environment.

## Your application

Imagine you own an e-commerce application, where you offer your users the ability to buy products, and leave reviews on products.

One of the teams in your organization is working on a new feature that allows users to add products to their wishlists, and it is controlled by a feature flag called `wishlist`.

## Attributes

Before continuing further with feature flags, let's have our Featurevisor attributes defined for our application.

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

To learn about what `capture` property does, see [Attributes](/docs/attributes) page.

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

Even though the feature itself is disabled in production for everyone, we still wish our QA team to be able to access it so they can perform their testing and let the feature owning team know about the results before they proceed to roll it out for everyone later.

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

{% callout type="note" title="User IDs for automated tests" %}
If you are running automated tests in production without involving any QA team, then you can pass the User IDs of the test accounts that you want to run your tests against.
{% /callout %}

## Making things more maintainable with segments

The above approach works, but it can be a bit cumbersome to maintain as the number of QA team members (or your predefined test user accounts) grow and also when their responsibilities for testing grow beyond just one feature at a time.

We can make things more maintainable by creating a new `qa` [segment](/docs/segments):

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

From now on, every time we wish to test a new feature in production, we can just add the `qa` segment to it, and the QA team members will be able to access it.

We could have also named our segment `testAccounts` instead of `qa` and include the User IDs of the test accounts instead of the QA team members. The meaning of this segment still stays the same.

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

We turned our original condition in the segment to an `or` condition, and added the `deviceId` condition to it. This way, whenever any of the conditions match, we will consider the user (either logged in or not) as a QA team member.

## Gradual rollout

Once the QA team has verified that the feature works as expected:

- the `qa` segment can be removed from the feature's rule, and
- we can begin rolling it out to a small percentage of our real users in production.

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

We have just learned how to coordinate testing in production in our organization with Featurevisor, where we can expose features to a subset of known users who can provide us early feedback (either manually or in an automated way), and how to evaluate those features with SDKs reliably.

All done while maintaining a single source of truth for managing the QA segment, and without having to deploy any code changes of our application.

Featurevisor is smart enough to not include any segment (like `qa`) in generated datafiles that is not being used actively in any of the feature flags belonging to any generated datafiles, so we don't have to worry about the datafile size growing unnecessarily.
