---
title: Microfrontends Architecture
description: Learn how to manage your features in a microfrontends architecture.
ogImage: /img/og/docs-use-cases-microfrontends.png
---

Microfrontends are a way of architecting your frontend application as a composition of loosely coupled features. Each feature is owned by a separate team, and can be developed and deployed independently. {% .lead %}

## Benefits

Going deep into microfrontends architecture is not the goal of this guide. But we will briefly mention some of its key benefits:

- **Development**: Each team can develop their features independently allowing work to be done in parallel
- **Tech stack**: Each microfrontend can be developed using the technology that best suits the team
- **Deployment**: Each microfrontend can be deployed independently at their own pace
- **Ownership**: Each team can own their own feature and be solely responsible for it
- **Rolling back**: If a particular microfrontend breaks, it can be rolled back without affecting the rest of the application

See this talk by [Luca Mezzalira](https://twitter.com/lucamezzalira) for further explanation [here](https://www.youtube.com/watch?v=BuRB3djraeM).

## Challenges

With all the freedom and autonomy, microfrontends architecture also comes with its own set of challenges, especially when it comes to [feature management](/docs/feature-management):

- **Consistency**: It can be hard to maintain consistency of features across all microfrontends
- **Overlaps**: Some features may overlap across multiple microfrontends
- **Anonymous vs authenticated users**: It is possible that some microfrontends are only accessible to either anonymous or authenticated users, or even both, making [consistent bucketing](/docs/bucketing) tricky
- **Reviews and approvals**: It can be hard to keep track of and coordinate all the features and their changes across all microfrontends

Rest of this guide will help us understand how Featurevisor can help mitigate these concerns in your team and organization.

## Frameworks

There are several frameworks and tools that can help achieve this architecture, such as:

- [Module federation](https://webpack.js.org/concepts/module-federation/) (webpack)
- [single-spa](https://single-spa.js.org/)

## Your application

Imagine you have an e-commerce application, where you offer your users the ability to:

- browse products
- sign up and in
- add to cart and buy products, and
- manage their account

## Mapping activities against microfrontends

We can map all these activities to their own microfrontend as follows:

| Microfrontend | Activities      | Path        | Access              |
|---------------|-----------------|-------------|---------------------|
| `products`    | Browse products | `/products` | Everyone            |
| `signup`      | Sign up         | `/signup`   | Anonymous users     |
| `signin`      | Sign in         | `/signin`   | Anonymous users     |
| `checkout`    | Buy products    | `/checkout` | Everyone            |
| `account`     | Manage account  | `/account`  | Authenticated users |

Each microfrontend will be accessible via its own URL path, like `yoursite.com/products`, `yoursite.com/signup`, etc.


{% callout type="note" title="Advanced microfrontends" %}
We are using a very simple example here. But in a real world application, each microfrontend can be much more advanced, where a microfrontend can be:

- taking over a single route, or
- taking over a group of routes, or
- rendering one or more components on a page that is already owned by another microfrontend
{% /callout %}

## Configuring tags

Your entire application can contain several feature flags, but given it is a microfrontends architecture, we want to make sure that each microfrontend only loads the features it needs.

Otherwise it will result into bloated datafiles with unnecessary data transfer and processing that will slow down your application.

To achieve that, we need to let our Featurevisor [configuration](/docs/configuration) know which tags we want to build our datafiles for:

```js
// featurevisor.config.js
module.exports = {
  environments: [
    "staging",
    "production",
  ],

  tags: [
    'products',
    'signup',
    'signin',
    'checkout',
    'account'
  ]
};
```

Once this configuration is in place, we can [build](/docs/building-datafiles) our datafiles:

```
$ featurevisor build
```

And it will output the following datafiles in the `dist` directory:

```
$ tree dist
dist
├── production
│   ├── datafile-tag-products.json
│   ├── datafile-tag-signup.json
│   ├── datafile-tag-signin.json
│   ├── datafile-tag-checkout.json
│   └── datafile-tag-account.json
└── staging
│   ├── datafile-tag-products.json
│   ├── datafile-tag-signup.json
│   ├── datafile-tag-signin.json
│   ├── datafile-tag-checkout.json
│   └── datafile-tag-account.json

2 directories, 10 files
```

## Attributes

We will set up some Featurevisor attributes first, that we will use in various stages of this guide later.

### `userId`

```yml
# attributes/userId.yml
description: Unique identifier of the logged in User
type: string
capture: true
```

### `deviceId`

This ID can be generated at the client-side level when user first visits your app, and stored in a cookie or localStorage for e.g. if in a browser environment.

```yml
# attributes/deviceId.yml
description: Unique identifier of the device
type: string
capture: true
```

## Feature

For this example, we will create a new feature flag that's responsible for toggling a marketing banner that's shown at the bottom of a page. We can call it `showMarketingBanner`.

```yml
# features/showMarketingBanner.yml
description: Shows marketing banner at the bottom of the page
tags:
  - <your-tag-here> # we will discuss this in next section below

defaultVariation: false

bucketBy: deviceId

variations:
  - value: true
    weight: 100

  - value: false
    weight: 0

environments:
  staging:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100

  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

## Tagging features

When we create or update any feature in your Featurevisor project, we can tag it with the microfrontend it belongs to:

```yml
# features/showMarketingBanner.yml
description: Shows marketing banner at the bottom of the page
tags:
  - products # tagging with `products` microfrontend

# ...
```

It is possible some features may overlap across microfrontends. For example, we may want to show a marketing banner to users in both the `products` and `checkout` microfrontends. In that case, we can tag the feature with both microfrontends:

```yml
# features/showMarketingBanner.yml
description: Shows marketing banner at the bottom of the page
tags:
  - products
  - checkout

# ...
```

## Anonymous vs Authenticated

Featurevisor relies on the feature's `bucketBy` property to determine how to [bucket](/docs/bucketing) the user into a variation.

It's an easy decision to make when choosing the `bucketBy` value when the microfrontend is only accessible to either anonymous or authenticated users, and not both.

| Microfrontend | Access          | `bucketBy` |
|---------------|-----------------|------------|
| `signup`      | Anonymous users | `deviceId` |
| `signin`      | Anonymous users | `deviceId` |
| `account`     | Authenticated   | `userId`   |

But what shall we do for microfrontends that are accessible to both anonymous and authenticated users? Like `products` and `checkout` in our example.

### Design decision

It's a design decision that we need to take here when defining our features.

We can either choose to:

- always use `deviceId` attribute for `bucketBy`, irrespective of whether the user is anonymous or authenticated, or
- we can choose to use `deviceId` for anonymous users and `userId` for authenticated users.

The drawback of using `deviceId` at all times for both anonymous and authenticated users is that it will result in inconsistent variations for logged in users across multiple sessions or devices.

If we wish to get the maximum benefit of Featurevisor's consistent bucketing making sure the same logged in user sees the same variation across all devices and sessions, we can use:

- `userId` for authenticated users, and
- `deviceId` for anonymous users

### Bucket by first available attribute

We can express that in our feature as follows:

```yml
# features/showMarketingBanner.yml
description: Shows marketing banner at the bottom of the page
tags:
  - products
  - checkout

bucketBy:
  # if `userId` is available then it will be used,
  # otherwise it will fall back to `deviceId`
  or:
    - userId
    - deviceId

# ...
```

This will make sure when `userId` attribute is passed for evaluation to the SDK, it will be used for bucketing. Otherwise, it will fall back to `deviceId`.

## Review and approval workflow

Given Featurevisor is a centralized feature management solution, it can help you manage your features in a microfrontends architecture in a single place conveniently.

In our case, it is a single Git repository that contains all the features and their configurations, which will go through a review and approval workflow by all relevant teams before they can be deployed in the form of generated [datafiles](/docs/building-datafiles).

## Consuming datafiles in your microfrontend

Once you have [built](/docs/building-datafiles) and [deployed](/docs/deployment) your datafiles, you can consume them using Featurevisor SDKs in your microfrontends:

```js
// in `products` microfrontend
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafileUrl: "https://cdn.yoursite.com/production/datafile-tag-products.json",
});
```

Evaluate your features:

```js
const attributes = {
  deviceId: "...",

  // if available
  userId: "...",
};

const showMarketingBanner = sdk.getVariation(
  "showMarketingBanner",
  attributes
);

if (showMarketingBanner) {
  // render marketing banner
}
```

While the snippets above suggest the usage of Featurevisor SDK in a single `products` microfrontend, it does not differ in any way if you were to use it in a monolithic application.

## Conclusion

We have seen how we can use Featurevisor to manage all our feature configurations in a microfrontends architecture in a single place declaratively, even if those features overlap and are used in multiple microfrontends together.

We have also seen how to handle tricky situations like anonymous vs authenticated users, and how to make sure logged in users are bucketed in a way so they see the same variation across all devices and sessions consistently maintaining a solid user experience.

The freedom and flexibility that microfrontends architecture brings in is great, but it also comes with its own set of challenges. Featurevisor can help you manage your features in a microfrontends architecture bringing all parties together with a strong reviews and approval workflow, and make sure your features are consistent across all your microfrontends for your users.
