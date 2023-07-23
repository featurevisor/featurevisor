---
title: Google Analytics (GA)
description: Learn how to integrate Featurevisor SDK with Google Tag Manager & Google Analytics
ogImage: /img/og/docs-tracking-google-analytics.png
---

This guide details how to track and analyse your experiments data in Google Analytics by tracking Featurevisor SDK's activation events via Google Tag Manager (GTM). {% .lead %}

## What is Google Analytics (GA)?

Google Analytics (GA) is a web service that offers analytics solutions which allow businesses to report and analyse the behaviour of their traffic, both on web and native mobile applications.

## What is Google Tag Manager (GTM)?

Google Tag Manager (GTM) is a free tag management solution that allows users to add and edit snippets of code (tags) that collect, shape and send data to your Google Analytics instance. GTM offers a user friendly UI, empowering non-technical professionals to deploy and update snippets of code autonomously, while offering them the possibility to benefit version control principles.

## Create a new tag in GTM

To create a new tag, you will first need to select one of predefined templates supported in GTM. For our use case, select the GA4 tag template, which sends data directly to your Google Analytics property, where experiment results can be analysed.

In the tag, set the Event Name to `featurevisor_activation` and then proceed to add all the parameters and user properties that you want to pass along with the event. Finally, add the trigger that will fire your tag. Select the Custom Event trigger and set it to match the name of the event that is pushed to the dataLayer (see next section for how-to guide).

{% callout type="note" title="Naming convention" %}
It is considered best practice to set event names in GA4 using the underscored format, while it is preferable to send events to the `dataLayer` using the camel-cased format.
{% /callout %}

## Push activation event with metadata

The SDK integration snippet below provides a guide on how to push the `featurevisorActivation` event to the dataLayer created by Google Tag Manager.

```js
import { createInstance } from '@featurevisor/sdk';

const sdk = createInstance({
  datafileUrl: "https://cdn.yoursite.com/datafile.json",

  onActivation: function (
    featureKey,
    variationValue,
    allAttributes,
    capturedContext
  ) {
    const { userId } = capturedContext;

    // push to dataLayer here
    window.dataLayer.push({
      event: 'featurevisorActivation',
      featureKey: featureKey,
      variationValue,
      userId,
    });
  }
})
```

## Store metadata in custom dimensions

Event Parameters and User Properties (GA4) are custom defined dimensions in which the value of a user-defined variable is stored. These assets are generally used to attach contextual information that enriches the events that are sent to your GA4 instance.

To be able to filter your data and create cohorts for each of your experiments, make sure to pass the **unique key** of the feature and its variation as a Custom Dimension in your GA4 tags.

To achieve this, make sure to first register a new Custom Dimension on your interface and name it `featureKey`. You can decide whether to make that Custom Dimension an Event Parameter or a User Property based on the principles of your custom analytics implementation. Once done, add the parameter to all of your GA4 tags in Google Tag Manager to attach the information to the event.

## Analyse results

Now that the activation event is stored into your GA4 instance and is enriched by the feature information, you are ready to run analysis to establish the impact of the different variations of a feature.

Filtering of events and users can be achieved both directly on the GA interface as well as directly using the raw data exported to Google BigQuery, which is the recommended method for those who want to achieve a deeper level of analysis and reporting flexibility.
