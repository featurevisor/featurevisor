---
title: Google Tag Manager (GTM)
description: Learn how to integrate Featurevisor SDK with Google Tag Manager
---

You can send Featurevisor activation events coming from SDK to Google Tag Manager. {% .lead %}

## Custom events in GTM

Before tracking, make sure you have custom events set up in your container.

Find more info [here](https://support.google.com/tagmanager/answer/7679219?hl=en).

## SDK integration

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
      event: 'featurevisor-activation',
      featureKey,
      variationValue,
      capturedAttributes,
    });
  }
})
```
