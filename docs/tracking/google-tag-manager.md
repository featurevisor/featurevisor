---
title: Data Capturing via Google Tag Manager (GTM)
description: Learn how to integrate Featurevisor SDK with Google Tag Manager {% .lead %}
---
## Intro:

This article guides you on how to run experimentation analysis by leveraging your existing frontend dataset and enabling segmentation for bahvioural analysis through an established data collection method: Google Tag Manager. 

## Guide:

Custom events are user defined events that are pushed to the `dataLayer` to expose a particular information or track a certain action. GTM is able to extract and store the data contained in the event's payload through a particular type of trigger that listens to the `dataLayer` and fires tags when the custom condition is met.

## Send an experiment activation event to the `dataLayer` and collect data via GTM

The SDK integration section below provides a guide on how to push the `featurevisorActivation` event to the dataLayer created by Google Tag Manager. Once the event has been pushed to the dataLayer, the data can be sent to your Google Analytics property by firing a GA4 or Universal Analytics tag that leverages a Custom Event Trigger. Make sure to set the Custom Event Trigger to exactly match the name of the event pushed to the `dataLayer` (`featurevisorActivation`).

Find more info [here](https://support.google.com/tagmanager/answer/7679219?hl=en).

IMPORTANT: push the event to the `dataLayer` at the very moment when a user is first activated into an experiment to ensure qualitative data collection.

## SDK integration guide:

Listen to activation events and push them to your `dataLayer`:

```js
import { createInstance } from '@featurevisor/sdk';

const sdk = createInstance({
  datafileUrl: "https://cdn.yoursite.com/datafile.json",

  onActivation: function (
    featureKey,
    variationValue,
    allAttributes,
    capturedAttributes
  ) {
    // push to dataLayer here
    window.dataLayer.push({
      event: 'featureVisorActivation',
      featureKey,
      variationValue,
      capturedAttributes,
    });
  }
})
```

## Pass the experiment name and its metadata as a Custom Dimension in your GTM Tags

To be able to filter your data and create segmentation for each of your experiments, make sure to pass the unique id of the experiment and its variation as a Custom Dimension in your GA4 tags. To achieve this, make sure to first register a new Custom Dimension on your interface and name it `fv_experiment_id`. You can decide whether to make that Custom Dimension an Event Paramenter or a User Property based on the principles of your custom analytics implementation. Once done, add the parameter to all of your GA4 tags in Google Tag Manager to attach the information to the event.

## Analyse the results of your experiment 

Now that the hit is stored into your Google Analytics instance and is enriched by the experimentat information, you are ready to run analysis to establish the impact of the different variations of an experiment. Segmentation of events and users can be achieved both directly on the GA interface as well as directly using the raw data exported to Google BigQuery, which is the recommend method for those who want to achieve a deeper level of analysis and reporting flexibility.
