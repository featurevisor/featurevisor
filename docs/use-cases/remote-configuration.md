---
title: Remote configuration
description: Learn how to manage remote configuration using Featurevisor
ogImage: /img/og/docs-use-cases-remote-configuration.png
---

Remote configuration refers to the ability of modifying the behaviour or settings of an application while it is running, without the need for restarting, redeploying, or making any code changes. {% .lead %}

This approach allows developers and system administrators to adjust various aspects of an application's behaviour, such as feature availability or other configuration parameters, without requiring downtime or disrupting the application's ongoing operation.

## Benefits

Separating runtime configuration from your application using Featurevisor brings in a lot of benefits:

- **Flexibility & agility**: Allows for greater flexibility in adapting the application's behavior to changing business requirements, user preferences, or market conditions.
- **Reduced time & effort**: Configuration changes can be made independently without the need for application deployments, reducing time and effort.
- **Personalized experience**: Allows for targeted configuration of features or settings to specific users or groups of users, such as beta testers, internal users, or paying customers.
- **Reduced risk & downtime**: It eliminates the need for deploying new application code or taking the application offline, reducing the potential for introducing bugs or causing downtime during configuration updates.
- **Auditing & versioning**: Facilitates tracking and auditing changes made to configuration settings. It enables versioning of configuration parameters, ensuring that previous configurations can be reverted if needed and providing a clear history of configuration changes for troubleshooting or compliance purposes.
- **Multi-environment**: Allows for different configurations to be applied in different environments, such as development, testing, staging, and production.

## Our application

Let's assume we have an e-commerce web application, where we wish to parameterize several aspects of it as configuration.

The application allows its users to:

- browse products
- sign up and in
- add products to cart
- pay for the products (checkout)
- manage their account

## Configuration parameters

We can identify the following configuration parameters that we wish to manage during the checkout flow:

- list of payment methods (like credit card, PayPal, etc.)
- list of credit cards (like Visa, Mastercard, AMEX, etc.)
- list of shipping methods (like standard, express, etc.)
- allow discount code (or gift card)

{% callout type="note" title="Understanding the building blocks" %}
Before going further in this guide, you are recommended to learn about the building blocks of Featurevisor to understand the concepts used in this guide:

- [Attributes](/docs/attributes): building block for conditions
- [Segments](/docs/segments): conditions for targeting users
- [Features](/docs/features): feature flags and variables with rollout rules
- [SDKs](/docs/sdks): how to consume datafiles in your applications

The [quick start](/docs/quick-start) can be very handy as a summary.
{% /callout %}

## Defining our feature

We can start by creating a new feature called `checkout` that has boolean variations only for now:

```yml
# features/checkout.yml
description: Checkout flow configuration
tags:
  - checkout

bucketBy: userId

defaultVariation: false

# we create a boolean variation for now
variations:
  - value: true
    weight: 100

  - value: false
    weight: 0

# rolled out as `true` to 100% of our traffic
environments:
  production:
    rules:
      - key: "1"
        segments: "*" # everyone
        percentage: 100
```

## Variables

Featurevisor supports [variables](/docs/features/#variables) that can be used to define configuration parameters.

We can extend our feature to include variable schema starting with `paymentMethods`:

```yml
# features/checkout.yml
description: Checkout flow configuration
tags:
  - checkout

bucketBy: userId

defaultVariation: false

# we add variable schema for all our parameters here,
# starting with `paymentMethods` for now
variablesSchema:
  - key: paymentMethods
    type: array
    defaultValue:
      - creditCard
      - paypal
      - applePay
      - googlePay

variations:
  - value: true
    weight: 100

  - value: false
    weight: 0

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # everyone
        percentage: 100
```

By default, we are saying that all our users will be able to use all the payment methods.

## Evaluating variables using SDK

Once we have [built](/docs/building-datafiles) and [deployed](/docs/deployment) our datafiles, we can start consuming them in our application using Featurevisor [SDKs](/docs/sdks).

We initialize the SDK first:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafileUrl: "https://cdn.yoursite.com/datafile.json",
  onReady: () => console.log("Datafile has been fetched and SDK is ready"),
});
```

Now we can evaluate the variable in our application:

```js
const featureKey = "checkout";
const variableKey = "paymentMethods";
const context = { userId: "user-123", country: "nl" };

const paymentMethods = sdk.getVariable(
  featureKey,
  variableKey,
  context
);

console.log(paymentMethods);
// [
//   "creditCard",
//   "paypal",
//   "applePay",
//   "googlePay"
// ]
```

With this evaluated ordered array of payment methods in the runtime, we can now render the list of payment methods in our checkout flow of the application without having to hardcode this list anywhere.

## Overriding variables by rules

From above example, we can see that all our users will be able to use all the payment methods.

But what if we want to restrict some payment methods to some users based in certain countries?

We can do that by overriding the variables via our rollout [rules](/docs/features/#rules).

Assuming we already have a [segment](/docs/segments) created for targeting users in the Netherlands:

```yml
# segments/netherlands.yml
description: Target users in the Netherlands
conditions:
  - attribute: country
    operator: equals
    value: nl
```

We can now use this segment in our rollout rules and override the `paymentMethods` variable:

```yml
# features/checkout.yml

# ...

environments:
  production:
    rules:
      - key: "2"
        segments:
          - netherlands
        percentage: 100
        variables:
          paymentMethods:
            - paypal
            - ideal

      - key: "1"
        segments: "*"
        percentage: 100
```

Now when we evaluate our features, we will get different results for users in the Netherlands:

```js
// Users in the Netherlands
const context = { userId: "user-234", country: "nl" };

const paymentMethods = sdk.getVariable(
  featureKey,
  variableKey,
  context
);

console.log(paymentMethods);
// [
//   "paypal",
//   "ideal"
// ]
```

While rest of the world will still get the same result as before (that is the default value as defined in the variable schema):

```js
// Users in the US
const context = { userId: "user-123", country: "us" };

const paymentMethods = sdk.getVariable(
  featureKey,
  variableKey,
  context
);

console.log(paymentMethods);
// [
//   "creditCard",
//   "paypal",
//   "applePay",
//   "googlePay"
// ]
```

## Other ways of overriding variables

Depending on your needs, it is also possible to override variables:

- at each [variation level](/docs/features/#overriding-variables) acting as an experiment, and also
- at environment level by [forcing it](/docs/features/#force)

You can see other use cases here detailing these approaches:

- [A/B & Multi-variate testing](/docs/use-cases/experiments)
- [Managing user entitlements](/docs/use-cases/entitlements)
- [Testing in production](/docs/use-cases/testing-in-production)

## How do applications get latest configuration?

There are two ways this can happen:

- You can configure your SDK to keep refreshing the datafile at a certain **interval** (like every 30 seconds), or
- When deploying your Featurevisor datafiles, you can broadcast a notification to all your applications to refresh their datafiles **manually** enabling over the air updates

You can refer to the SDK guide here for [refreshing datafile](/docs/sdks/#refreshing-datafile).

## Full feature example

Based on our original requirements, we can express the `checkout` feature with all its variables as follows:

```yml
# features/checkout.yml
description: Checkout flow configuration
tags:
  - checkout

bucketBy: userId

defaultVariation: false

variablesSchema:
  - key: paymentMethods
    type: array
    defaultValue:
      - creditCard
      - paypal
      - applePay
      - googlePay

  - key: creditCards
    type: array
    defaultValue:
      - visa
      - mastercard
      - amex

  - key: shippingMethods
    type: array
    defaultValue:
      - standard
      - express

  - key: allowDiscountCode
    type: boolean
    defaultValue: false

variations:
  - value: true
    weight: 100

  - value: false
    weight: 0

environments:
  production:
    rules:
      - key: "2"
        segments:
          - netherlands
        percentage: 100
        variables:
          paymentMethods:
            - paypal
            - ideal
          allowDiscountCode: true

      - key: "1"
        segments: "*"
        percentage: 100
```

Based on our requirements, we can keep overriding these variables against different rules as needed.

Learn more about [variables](/docs/features/#variables), its supported [types](/docs/features/#variable-types), and how to [override](/docs/features/#overriding-variables) them in [features](/docs/features) documentation.

## Conclusion

We learned about:

- various benefits of separating runtime configuration from our application
- how to break down different configuration parameters of our application into variables
- having them defined in a feature declaratively using Featurevisor
- overriding them using rollout rules based on our needs

Overall, Featurevisor can help manage your application's runtime configuration in a highly readable and maintainable way for your team and your organization, with a strong review and approval process in one single place for everyone in the form of a Git repository.
