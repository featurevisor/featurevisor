---
title: Experimentation
description: Learn how to experiment with A/B Tests and Multivariate Tests using Featurevisor.
ogImage: /img/og/docs-use-cases-experimentation.png
---

Running experiments like A/B Testing and Multivariate Testing is a powerful technique in product development for continuous learning and iterating based on feedback. Featurevisor can help manage those experiments with a strong governance model in your organization. {% .lead %}

## What is an A/B Test?

An **A/B test**, also known as **split testing** or **bucket testing**, is a controlled experiment used to compare two or more variations of a specific feature to determine which one performs better. It is commonly used in fields like web development, marketing, user experience design, and product management.

## Why run A/B Tests?

The primary goal of an A/B test is to measure the impact of the variations on predefined metrics or key performance indicators (KPIs). These metrics can include conversion rates, click-through rates, engagement metrics, revenue, or any other measurable outcome relevant to the experiment.

By comparing the performance of the different variants, statistical analysis is used to determine if one variant outperforms the others with statistical significance. This helps decision-makers understand which variant is likely to have a better impact on the chosen metrics.

## Process of running an A/B Test

A/B testing follows a structured process that typically involves the following steps:

1. **Identify the element to be tested**: Determine the specific element, such as a webpage, design element, pricing model, or user interface component, that will be subjected to variation.
1. **Create variations**: Develop multiple versions of the element, ensuring they are distinct and have measurable differences.
1. **Split traffic or users**: Randomly assign users or traffic into separate groups, with each group exposed to a different variant.
1. **Run the experiment**: Implement the variants and collect data on the predefined metrics for each group over a specified period.
1. **Analyze the results**: Use statistical analysis to compare the performance of the variants and determine if any differences are statistically significant.
1. **Make informed decisions**: Based on the analysis, evaluate which variation performs better and whether it should be implemented as the new default or further optimized.

## What about Multivariate Testing?

A multivariate test is an experimentation technique that allows you to simultaneously test multiple variations of multiple elements or factors within a single experiment.

Unlike A/B testing, which focuses on comparing two or more variants of a single element, multivariate testing involves testing combinations of elements and their variations to understand their collective impact on user behavior or key metrics.

## Difference between A/B Tests and Multivariate Tests

|                          | A/B Tests                                                      | Multivariate Tests                                                                             |
|--------------------------|----------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| Purpose                  | Compare two or more variants of a single element               | Simultaneously test multiple elements and variations                                           |
| Variants                 | Two or more variants (Control and Treatment)                   | Multiple variants for each element being tested                                                |
| Scope                    | Focuses on one element at a time                               | Tests combinations of elements and their variations                                            |
| Complexity               | Relatively simpler to set up and analyze                       | and analyze	More complex to set up and analyze                                                 |
| Statistical Significance | Typically requires fewer samples to achieve significance       | Requires larger sample sizes to achieve significance                                           |
| Insights                 | Provides insights into the impact of individual changes        | Provides insights into the interaction between changes                                         |
| Test Duration            | Generally shorter duration                                     | Often requires longer duration to obtain reliable results                                      |
| Examples                 | Ideal for testing isolated changes, UI tweaks, copy variations | Useful for testing larger-scale changes, page redesigns, interaction between multiple elements |

## Your application

For this guide, let's say your application consists of a landing page containing these elements:

- **Hero section**: The main section of the landing page, which includes:
  - headline
  - subheading, and
  - call-to-action (CTA) button
- **Pricing**: The pricing section of the landing page, which includes:
  - pricing plans, and
  - their features

We now want to run both A/B Tests and Multivariate Tests using Featurevisor.

## A/B Test on CTA button

Let's say we want to run an A/B Test on the CTA button in the Hero section of your landing page.

The two variations for a simple A/B test experiment would be:

- **control**: The original CTA button with the text "Sign up"
- **treatment**: The new CTA button with the text "Get started"

We can express that in Featurevisor as follows:

```yml
# features/ctaButton.yml
description: CTA button
tags:
  - all

bucketBy: deviceId

defaultVariation: control

variations:
  - value: control
    description: Original CTA button
    weight: 50

  - value: treatment
    description: New CTA button that we want to test
    weight: 50

environments:
  production:
    rules:
      - key: "1"
        segments: "*" # everyone
        percentage: 100 # 100% of the traffic
```

We just set up our first A/B test experiment that is:

- rolled out to 100% of our traffic to everyone
- with a 50/50 split between the `control` and `treatment` variations
- to be bucketed against `deviceId` attribute (since we don't have the user logged in yet)

The `deviceId` attribute can be an unique UUID generated and persisted at client-side level where SDK evaluates the features.

## Evaluating feature with SDKs

Now that we have defined our feature, we can use Featurevisor SDKs to evaluate the CTA button variation in the runtime, assuming we have already [built](/docs/building-datafiles/) and [deployed](/docs/deployment/) the datafiles to our CDN.

For Node.js and browser environments, install the JavaScript SDK:

```
$ npm install @featurevisor/browser
```

Then, initialize the SDK in your application:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafile: "https://cdn.yoursite.com/datafile.json",

  onReady: () => console.log("Datafile has been fetched and SDK is ready")
});
```

Now we can evaluate the `ctaButton` feature wherever we need to render the CTA button:

```js
const featureKey = "ctaButton";
const attributes = { deviceId: "device-123" };

const ctaButtonVariation = sdk.getVariation(featureKey, attributes);

if (ctaButtonVariation === "treatment") {
  // render the new CTA button
  return "Get started";
} else {
  // render the original CTA button
  return "Sign up";
}
```

Here we see only two variation cases, but we could have had more than two variations in our A/B test experiment.

## Multivariate Test on Hero element

Let's say we want to run a Multivariate Test on the Hero section of your landing page.

Previously we only ran an A/B test on the CTA button's text, but now we want to run a Multivariate Test on the Hero section affecting some or all its elements. We can map our requirements in a table below:

| Variation  | Headline    | CTA button text |
|------------|-------------|-----------------|
| control    | Welcome     | Sign up         |
| treatment1 | Welcome     | Get started     |
| treatment2 | Hello there | Sign up         |
| treatment2 | Hello there | Get started     |

Instead of creating a separate feature per element, we can create a single feature for the Hero section and define multiple variables for each element.

```yml
# features/hero.yml
description: Hero section
tags:
  - all

bucketBy: deviceId

defaultVariation: control

# define a schema of all variables
# scoped under `hero` feature first
variablesSchema:
  - key: headline
    type: string
    defaultValue: Welcome

  - key: ctaButtonText
    type: string
    defaultValue: Sign up

variations:
  - value: control
    weight: 25

  - value: treatment1
    weight: 25
    variables:
      # we only define variables inside variations,
      # if the values are different than the default values
      - key: ctaButtonText
        value: Get started

  - value: treatment2
    weight: 25
    variables:
      - key: headline
        value: Hello there

  - value: treatment3
    weight: 25
    variables:
      - key: headline
        value: Hello there

      - key: ctaButtonText
        value: Get started

environments:
  production:
    rules:
      - key: "1"
        segments: "*"
        percentage: 100
```

We just set up our first Multivariate test experiment that is:

- rolled out to 100% of our traffic to everyone
- with an even 25% split among all its variations
- with each variation having different values for the variables

## Evaluating variables

In your application, you can access the variables of the `hero` feature as follows:

```js
const featureKey = "hero";
const attributes = { deviceId: "device-123" };

const headline = sdk.getVariable(featureKey, "headline", attributes);
const ctaButtonText = sdk.getVariable(featureKey, "ctaButtonText", attributes);
```

Use the values inside your hero element (component) when you render it.

## Tracking

We understood how to create features for defining simple A/B tests and also more complex multivariates using variables in Featurevisor, and then evaluate them in the runtime in our applications when we need those values.

But we also need to track the performance of our experiments to understand which variation is doing better than others.

This is where the `activate()` method of the SDK comes in handy. Before we call the method, let's first set up our activation event handler in the SDK initialization:

```js
import { createInstance } from "@featurevisor/sdk";

const sdk = createInstance({
  datafile: "https://cdn.yoursite.com/datafile.json",

  onReady: () => console.log("Datafile has been fetched and SDK is ready"),

  onActivate: (featureKey, variation, attributes, captureAttributes) => {
    // send the event to your analytics platform
    // or any other third-party service
  }
});
```

In the `onActivate` handler, we know which feature was activated and which variation was computed for the current user or device. From here, we are in full control of sending the event to our analytics platform or any other third-party service for further analysis.

{% callout type="note" title="Featurevisor is not an analytics platform" %}
It is important to understand that Featurevisor is not an analytics platform. It is a feature management tool that helps you manage your features and experiments with a Git-based workflow, and helps evaluate your features in your application with its SDKs.
{% /callout %}

## Activation

From the application side, we need to take the responsibility of activating the feature when we are sure that the user has been exposed this feature.

For example, in the case of our CTA button experiment, we can activate the feature when the user sees the CTA button on their screen:

```js
const featureKey = "hero";
const attributes = { deviceId: "device-123" };

sdk.activate(featureKey, attributes);
```

## Mutually exclusive experiments

Often times when you are running multiple experiments together, you want to make sure that they are mutually exclusive. This means that a user should not be bucketed into multiple experiments at the same time.

In more plain words, the same user should not be exposed to multiple experiments together, and only one experiment at a time avoiding any overlap.

One example: if User X is exposed to feature `hero` which is running our multivariate test, then the same User X should not be exposed to feature `wishlist` which is running some other A/B test in the checkout flow of the application.

For those cases, you are recommended to see the [Groups](/docs/groups/) functionality of Featurevisor, which will help you achieve exactly that without your applications needing to do any extra code changes at all.

## Conclusion

We learned how to use Featurevisor for:

- Creating both simple A/B tests and more complex Multivariate tests
- evaluate them in the runtime in our applications
- track the performance of our experiments
- activate the features when we are sure that the user has been exposed to them
- make multiple experiments mutually exclusive if we need to

Featurevisor can be a powerful tool in your experimentation toolkit, and can help you run experiments with a strong governance model in your organization given every change goes through a Pull Request in your Git repository and nothing gets merged without reviews and approvals.
