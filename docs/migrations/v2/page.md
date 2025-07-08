---
title: Migrating from v1 to v2
showInlineTOC: true
nextjs:
  metadata:
    title: Migrating from v1 to v2
    description: Guide for migrating from Featurevisor v1 to v2
    openGraph:
      title: Migrating from v1 to v2
      description: Guide for migrating from Featurevisor v1 to v2
      images:
        - url: /img/og/docs-migrations-v2.png
---

Detailed guide for migrating existing Featurevisor projects (using Featurevisor CLI) and applications (using Featurevisor SDKs) to latest v2.0.

---

## Defining attributes

### Attribute as an object {% label="New" labelType="success" %}

Attribute values in context can now also be flat objects.

You can still continue to use other existing attribute types without any changes. This change is only if you wish to define attributes as objects.

#### Defining attribute

{% row %}
{% column %}

```yml {% title="Before" path="attributes/userId.yml" %}
description: My userId attribute

type: string
```

```yml {% title="Before" path="attributes/userCountry.yml" %}
description: My userCountry attribute

type: string
```

{% /column %}
{% column %}

```yml {% title="After" path="attributes/user.yml" highlight="3,6,9" %}
description: My user attribute description

type: object

properties:
  id:
    type: string
    description: The user ID
  country:
    type: string
    description: The country of the user
```

{% /column %}
{% /row %}

#### Passing attribute in context

When evaluating values in your application with SDKs, you can pass the value as an object:

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="4-5" %}
const f; // Featurevisor SDK instance

const context = {
  userId: '123',
  userCountry: 'nl',
  browser: 'chrome',
}



const isFeatureEnabled = f.isEnabled(
  'myFeature',
  context
)
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="4-7" %}
const f; // Featurevisor SDK instance

const context = {
  user: {
    id: '123',
    country: 'nl',
  },
  browser: 'chrome',
}

const isFeatureEnabled = f.isEnabled(
  'myFeature',
  context
)
```

{% /column %}
{% /row %}

#### Dot separated path

You can make use of dot-separated paths to specify nested attributes.

For example, inside features:

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="3" %}
# ...

bucketBy: userId
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="3" %}
# ...

bucketBy: user.id
```

{% /column %}
{% /row %}

And also in conditions:

{% row %}
{% column %}

```yml {% title="Before" path="segments/netherlands.yml" highlight="4" %}
description: Netherlands segment

conditions:
  - attribute: userCountry
    operator: equals
    value: nl
```

{% /column %}
{% column %}

```yml {% title="After" path="segments/netherlands.yml" highlight="4" %}
description: Netherlands segment

conditions:
  - attribute: user.country
    operator: equals
    value: nl
```

{% /column %}
{% /row %}

Learn more in [Attributes](/docs/attributes) page.

## Defining segments

### Conditions targeting everyone {% label="New" labelType="success" %}

We can now use asterisks (`*`) in conditions (either directly in segments or in features) to match any condition:

```yml {% path="segments/mySegment.yml" highlight="3" %}
description: My segment description

conditions: '*'
```

This is very handy when you wish to start with an empty segment, then later add conditions to it.

### Operator: exists {% label="New" labelType="success" %}

Checks if the attribute exists in the context:

{% row %}
{% column %}

```yml {% path="segments/mySegment.yml" highlight="4" %}
description: My segment description
conditions:
  - attribute: browser
    operator: exists
```

{% /column %}
{% column %}

```js {% path="your-app/index.js" highlight="5" %}
const f; // Featurevisor SDK instance

const context = {
  userId: '123',
  browser: 'chrome', // exists
}

const isFeatureEnabled = f.isEnabled(
  'myFeature',
  context
)
```

{% /column %}
{% /row %}

### Operator: notExists {% label="New" labelType="success" %}

Checks if the attribute does not exist in the context:

{% row %}
{% column %}

```yml {% path="segments/mySegment.yml" highlight="4" %}
description: My segment description
conditions:
  - attribute: browser
    operator: notExists
```

{% /column %}
{% column %}

```js {% path="your-app/index.js" highlight="5" %}
const f; // Featurevisor SDK instance

const context = {
  userId: '123',
  // `browser` does not exist
}

const isFeatureEnabled = f.isEnabled(
  'myFeature',
  context
)
```

{% /column %}
{% /row %}

### Operator: includes {% label="New" labelType="success" %}

Checks if a certain value is included in the attribute's array (of strings) value.

{% row %}
{% column %}

```yml {% path="segments/mySegment.yml" highlight="4" %}
description: My segment description
conditions:
  - attribute: permissions
    operator: includes
    value: write
```

{% /column %}
{% column %}

```js {% path="your-app/index.js" highlight="7" %}
const f; // Featurevisor SDK instance

const context = {
  userId: '123',
  permissions: [
    'read',
    'write', // included
    'delete',
  ],
}

const isFeatureEnabled = f.isEnabled(
  'myFeature',
  context
)
```

{% /column %}
{% /row %}

### Operator: notIncludes {% label="New" labelType="success" %}

Checks if a certain value is not included in the attribute's array (of strings) value.

{% row %}
{% column %}

```yml {% path="segments/mySegment.yml" highlight="4" %}
description: My segment description
conditions:
  - attribute: permissions
    operator: notIncludes
    value: write
```

{% /column %}
{% column %}

```js {% path="your-app/index.js" highlight="7" %}
const f; // Featurevisor SDK instance

const context = {
  userId: '123',
  permissions: [
    'read',
    // 'write' is not included
    'delete',
  ],
}

const isFeatureEnabled = f.isEnabled(
  'myFeature',
  context
)
```

{% /column %}
{% /row %}

### Operator: matches {% label="New" labelType="success" %}

Checks if the attribute's value matches a regular expression:

{% row %}
{% column %}

```yml {% path="segments/mySegment.yml" highlight="4" %}
description: My segment description
conditions:
  - attribute: userAgent
    operator: matches
    value: '(Chrome|Firefox)\/([6-9]\d|\d{3,})'

    # optional regex flags
    regexFlags: i
```

{% /column %}
{% column %}

```js {% path="your-app/index.js" highlight="5" %}
const f; // Featurevisor SDK instance

const context = {
  userId: '123',
  userAgent: window.navigator.userAgent,
}

const isFeatureEnabled = f.isEnabled(
  'myFeature',
  context
)
```

{% /column %}
{% /row %}

### Operator: notMatches {% label="New" labelType="success" %}

Checks if the attribute's value does not match a regular expression:

{% row %}
{% column %}

```yml {% path="segments/mySegment.yml" highlight="4" %}
description: My segment description
conditions:
  - attribute: userAgent
    operator: notMatches
    value: '(Chrome|Firefox)\/([6-9]\d|\d{3,})'

    # optional regex flags
    regexFlags: i
```

{% /column %}
{% column %}

```js {% path="your-app/index.js" highlight="5" %}
const f; // Featurevisor SDK instance

const context = {
  userId: '123',
  userAgent: window.navigator.userAgent,
}

const isFeatureEnabled = f.isEnabled(
  'myFeature',
  context
)
```

{% /column %}
{% /row %}

Learn more in [Segments](/docs/segments) page.

## Defining features

### Defining variable schema {% label="Breaking" labelType="error" %}

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="4" %}
# ...

variablesSchema:
  - key: myVariableKey
    type: string
    defaultValue: 'default value'
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="4" %}
# ...

variablesSchema:
  myVariableKey:
    type: string
    defaultValue: 'default value'
```

{% /column %}
{% /row %}

Learn more in [Variables](/docs/features/#variables) section.

### When feature is disabled, use default variable value {% label="New" labelType="success" %}

When a feature itself is evaluated as disabled, its variable values by default always get evaluated as empty (`undefined` in v1, and `null` in v2).

Now, you can choose on a per variable basis whether to serve the default value if the feature is disabled or default to `null`.

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="" %}
# ...

variablesSchema:
  - key: myVariableKey
    type: string
    defaultValue: default value
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="10" %}
# ...

variablesSchema:
  myVariableKey:
    type: string
    defaultValue: default value

    # optionally serve default value
    # when feature is disabled
    useDefaultWhenDisabled: true
```

{% /column %}
{% /row %}

Learn more in [Variables](/docs/features/#variables) section.

### When feature is disabled, serve different variable value {% label="New" labelType="success" %}

Instead of serving default value, if you want to a different value to be served for your variable whenthe feature itself is disabled, you can do this:

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="" %}
# ...

variablesSchema:
  - key: myVariableKey
    type: string
    defaultValue: default value
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="10" %}
# ...

variablesSchema:
  myVariableKey:
    type: string
    defaultValue: default value

    # optionally serve different value
    # when feature is disabled
    disabledValue: different value for disabled feature
```

{% /column %}
{% /row %}

Learn more in [Variables](/docs/features/#variables) section.

### When feature is disabled, serve a specific variation value {% label="New" labelType="success" %}

If the feature itself is evaluated as disabled, then its variation value will be evaluated as `null` by default.

If you wish to serve a specific variation value in those cases, you can do this:

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="" %}
# ...

variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="10" %}
# ...

variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50

disabledVariationValue: control
```

{% /column %}
{% /row %}

Learn more in [Variations](/docs/features/#variations) section.

### Variable overrides from variations {% label="Breaking" labelType="error" %}

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="9-15" %}
# ...

variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
    # had to be used together
    variables:
      - key: bgColor
        value: blue
        overrides:
          - segments: netherlands
            value: orange
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="9-15" %}
# ...

variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
    # can be overridden independently
    variables:
      bgColor: blue
    variableOverrides:
      bgColor:
        - segments: netherlands
          value: orange
```

{% /column %}
{% /row %}

Learn more in [Variables](/docs/features/#variables) section.

### Defining rules {% label="Breaking" labelType="error" %}

Rules have moved to top level of the feature definition, and the `environments` property is no longer used.

This has resulted in less nesting and more clarity in defining rules.

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="3-5" %}
# ...

environments:
  production:
    rules:
      - key: everyone
        segments: '*'
        percentage: 100
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="4-5" %}
# ...


rules:
  production:
    - key: everyone
      segments: '*'
      percentage: 100
```

{% /column %}
{% /row %}

Learn more in [Rules](/docs/features/#rules) section.

### Defining forced overrides {% label="Breaking" labelType="error" %}

Similar to rules above, force entries have moved to top level of the feature definition as well.

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="3-5" %}
# ...

environments:
  production:
    force:
      - segments: qa
        enabled: true
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="4-5" %}
# ...


force:
  production:
    - segments: qa
      enabled: true
```

{% /column %}
{% /row %}

Learn more in [Force](/docs/features/#force) section.

### Exposing feature in datafile {% label="Breaking" labelType="error" %}

The `expose` property had a very rare use case, that controlled the inclusion of a feature in generated datafiles targeting a specific environment and/or tag.

{% row %}
{% column %}

```yml {% title="Before" path="features/myFeature.yml" highlight="3-5" %}
# ...

environments:
  production:
    expose: false
```

{% /column %}
{% column %}

```yml {% title="After" path="features/myFeature.yml" highlight="4-5" %}
# ...


expose:
  production: false
```

{% /column %}
{% /row %}

Learn more in [Expose](/docs/features/#expose) section.

### Variation weight overrides {% label="New" labelType="success" %}

If you are running experiments, you can now override the weights of your variations on a per rule basis:

```yml {% path="features/myFeature.yml" highlight="4-9,17-20" %}
# ...

variations:
  # common weights for all rules
  - value: control
    weight: 50

  - value: treatment
    weight: 50

rules:
  production:
    - key: netherlands
      segments: netherlands
      percentage: 100

      # override the weights here for this rule alone
      variationWeights:
        control: 10
        treatment: 90

    - key: everyone
      segments: '*'
      percentage: 100
```

Learn more in [Variations](/docs/features/#variations) section.

---

## Project configuration

### outputDirectoryPath {% label="Breaking" labelType="error" %}

Default output directory path has been changed from `dist` to `datafiles`.

This is to better reflect the contents of the directory.

{% row %}
{% column %}

```js {% title="Before" path="featurevisor.config.js" highlight="3" %}
module.exports = {
  // defaulted to this directory
  outputDirectoryPath: 'dist',
}
```

{% /column %}
{% column %}

```js {% title="After" path="featurevisor.config.js" highlight="3" %}
module.exports = {
  // defaults to this directory
  datafilesDirectoryPath: 'datafiles',
}
```

{% /column %}
{% /row %}

### datafileNamePattern {% label="New" labelType="success" %}

Previously defaulted to `datafile-%s.json`, it has been changed to `featurevisor-%s.json`.

{% row %}
{% column %}

```js {% title="Before" path="featurevisor.config.js" highlight="2" %}
module.exports = {
  // no option available to customize it
}
```

{% /column %}
{% column %}

```js {% title="After" path="featurevisor.config.js" highlight="2" %}
module.exports = {
  datafileNamePattern: 'featurevisor-%s.json',
}
```

{% /column %}
{% /row %}

Learn more in [Configuration](/docs/configuration/) page.

---

## CLI usage

### Upgrade to latest CLI {% label="New" labelType="success" %}

In your Featurevisor project repository:

```text {% title="Command" %}
$ npm install --save @featurevisor/cli@2
```

### Building v1 datafiles {% label="New" labelType="success" %}

It is understandable you may have applications that still consume v1 datafiles using v1 compatible SDKs.

To keep supporting both v1 and v2 from the same project in a backwards compatible way, you can build new v2 datafiles as usual:

```{% title="Command" %}
$ npx featurevisor build
```

and on top of that, also build v1 datafiles:

```{% title="Command" %}
$ npx featurevisor build \
    --schema-version=1 \
    --no-state-files \
    --datafiles-dir=datafiles/v1
```

### Using hash as datafile revision {% label="New" labelType="success" %}

By default, every time you build datafiles, a new revision is generated which is an incremental number.

```{% title="Command" %}
$ npx featurevisor build
```

You may often have changes like updating a feature's description, which do not require a new revision number. To avoid that, you can pass `--revisionFromHash` option to the CLI:

```{% title="Command" %}
$ npx featurevisor build --revisionFromHash
```

If individual datafile contents do not change since last build, the revision will not change either. This helps implement caching when serving datafiles from CDN with ease.

### Datafile naming convention {% label="Breaking" labelType="error" %}

Naming convention of built datafiles has been changed from `datafile-tag-<tag>.json` to `featurevisor-tag-<tag>.json` to help distinguish between Featurevisor datafiles and other datafiles that may be used in your project:

{% row %}
{% column %}

```{% title="Before" highlight="1,4,6" %}
$ tree dist
.
├── production
│   └── datafile-tag-all.json
└── staging
    └── datafile-tag-all.json

2 directories, 2 files
```

{% /column %}
{% column %}

```js {% title="After" highlight="1,4,6" %}
$ tree datafiles
.
├── production
│   └── featurevisor-tag-all.json
└── staging
    └── featurevisor-tag-all.json

2 directories, 2 files
```

{% /column %}
{% /row %}

If you wish to maintain the old naming convention, you can update your project configuration:

```js {% path="featurevisor.config.js" highlight="4-5" %}
module.exports = {
  // ...

  datafilesDirectoryPath: 'dist',
  datafileNamePattern: 'datafile-%s.json',
}
```

---

## JavaScript SDK usage

### Upgrade to latest SDK {% label="New" labelType="success" %}

In your application repository:

```text {% title="Command" %}
$ npm install --save @featurevisor/sdk@2
```

### Fetching datafile {% label="Breaking" labelType="error" %}

This option has been removed from the SDK. You are now required to take care of fetching the datafile yourself and passing it to the SDK:

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="6-10" %}
import { createInstance } from '@featurevisor/sdk'

const DATAFILE_URL = '...'

const f = createInstance({
  datafileUrl: DATAFILE_URL,

  onReady: () => {
    console.log('SDK is ready')
  },
})
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="9" %}
import { createInstance } from '@featurevisor/sdk'

const DATAFILE_URL = '...'

const datafileContent = await fetch(DATAFILE_URL)
  .then((res) => res.json())

const f = createInstance({
  datafile: datafileContent,
})
```

`onReady` callback is no longer needed, as the SDK is ready immediately after you pass the datafile.

{% /column %}
{% /row %}

### Refreshing datafile {% label="Breaking" labelType="error" %}

This option has been removed from the SDK. You are now required to take care of fetching the datafile and then set to it existing SDK instance:

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="6-16,20,23-24" %}
import { createInstance } from '@featurevisor/sdk'

const DATAFILE_URL = '...'

const f = createInstance({
  datafileUrl: DATAFILE_URL,

  refreshInterval: 60, // every 60 seconds

  onRefresh: () => {
    console.log('Datafile refreshed')
  },

  onUpdate: () => {
    console.log('New datafile revision detected')
  },
})

// manually refresh
f.refresh()

// stop/start refreshing
f.stopRefreshing()
f.startRefreshing()
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="12-19,26" %}
import { createInstance } from '@featurevisor/sdk'

const DATAFILE_URL = '...'

const datafileContent = await fetch(DATAFILE_URL)
  .then((res) => res.json())

const f = createInstance({
  datafile: datafileContent,
})

const unsubscribe = f.on("datafile_set", ({
  revision, // new revision
  previousRevision,
  revisionChanged, // true if revision has changed
  features, // list of all affected feature keys
}) => {
  console.log('Datafile set')
});

// custom interval
setInterval(function () {
  const datafileContent = await fetch(DATAFILE_URL)
    .then((res) => res.json())

  f.setDatafile(datafileContent)
}, 60 * 1000);
```

`refreshInterval`, `onRefresh` and `onUpdate` options and `refresh` method are no longer supported.

{% /column %}
{% /row %}

### Getting variation {% label="Soft breaking" labelType="warning" %}

When evaluating the variation of a feature that is disabled, the SDK used to return `undefined` in v1.

This was challenging to handle in non-JavaScript SDKs, since there is no concept of `undefined` as a type there.

Therefore, it has been changed to return `null` in v2.

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="5" %}
const f; // Featurevisor SDK instance

const context = { userId: '123' }

// could be either `string` or `undefined`
const variation = f.getVariation(
  'myFeature',
  context
)
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="5" %}
const f; // Featurevisor SDK instance

const context = { userId: '123' }

// now either `string` or `null`
const variation = f.getVariation(
  'myFeature',
  context
)
```

{% /column %}
{% /row %}

### Getting variable {% label="Soft breaking" labelType="warning" %}

Similar to above for getting variation, when evaluating a variable of a feature that is disabled, the SDK will now return `null` instead of `undefined`.

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="5" %}
const f; // Featurevisor SDK instance

const context = { userId: '123' }

// could be either value or `undefined`
const variableValue = f.getVariable(
  'myFeature',
  'myVariableKey',
  context
)
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="5" %}
const f; // Featurevisor SDK instance

const context = { userId: '123' }

// now either value or `null`
const variation = f.getVariable(
  'myFeature',
  'myVariableKey',
  context
)
```

{% /column %}
{% /row %}

This is applicable for type specific SDK methods as well for variables:

- `getVariableString`
- `getVariableBoolean`
- `getVariableInteger`
- `getVariableDouble`
- `getVariableArray`
- `getVariableObject`
- `getVariableJSON`

### Activation {% label="Breaking" labelType="error" %}

Experiment activations are not handled by the SDK any more.

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="6-18,22" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  // ...

  onActivate: function ({
    featureKey,
    variationValue,
    fullContext,
    captureContext,
  }) {
    // send to your analytics service here
    track('activation', {
      experiment: featureKey,
      variation: variationValue,
      userId: fullContext.userId,
    })
  },
})

const context = { userId: '123' }
f.activate('featureKey', context)
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="6-13" %}
import { createInstance } from '@featurevisor/sdk'

const f; // Featurevisor SDK instance

const context = { userId: '123' }
const variation = f.getVariation("mFeature", context);

// send to your analytics service here
track('activation', {
  experiment: 'myFeature',
  variation: variation.value,
  userId: context.userId,
})
```

`activate` method and `onActivate` option are no longer supported.

You can also make use of new [Hooks API](#hooks).

{% /column %}
{% /row %}

### Sticky features {% label="Breaking" labelType="error" %}

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="15,19" %}
import { createInstance } from '@featurevisor/sdk'

const stickyFeatures = {
  myFeatureKey: {
    enabled: true,
    variation: 'control',
    variables: {
      myVariableKey: 'myVariableValue',
    },
  },
}

// when creating instance
const f = createInstance({
  stickyFeatures: stickyFeatures,
})

// replacing sticky features later
f.setStickyFeatures(stickyFeatures)
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="15,19" %}
import { createInstance } from '@featurevisor/sdk'

const stickyFeatures = {
  myFeatureKey: {
    enabled: true,
    variation: 'control',
    variables: {
      myVariableKey: 'myVariableValue',
    },
  },
}

// when creating instance
const f = createInstance({
  sticky: stickyFeatures,
})

// replacing sticky features later
f.setSticky(stickyFeatures, true)
```

Unless `true` is passed as the second argument, the sticky features will be merged with the existing ones.

{% /column %}
{% /row %}

### Initial features {% label="Breaking" labelType="error" %}

Initial features used to be handy for setting some early values before the SDK fetched datafile and got ready.

But since datafile fetching responsibility is now on you, the initial features are no longer needed.

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="15" %}
import { createInstance } from '@featurevisor/sdk'

const initialFeatures = {
  myFeatureKey: {
    enabled: true,
    variation: 'control',
    variables: {
      myVariableKey: 'myVariableValue',
    },
  },
}

// when creating instance
const f = createInstance({
  initialFeatures: initialFeatures,
})
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="15,19,22-27" %}
import { createInstance } from '@featurevisor/sdk'

const initialFeatures = {
  myFeatureKey: {
    enabled: true,
    variation: 'control',
    variables: {
      myVariableKey: 'myVariableValue',
    },
  },
}

// you can pass them as sticky instead
const f = createInstance({
  sticky: initialFeatures,
})

// fetch and set datafile after
f.setDatafile(datafileContent)

// remove sticky features after
f.setSticky(
  {},

  // replacing with empty object
  true
)
```

{% /column %}
{% /row %}

### Setting context {% label="New" labelType="success" %}

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="11" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  // ...
})

const isFeatureEnabled = f.isEnabled(
  'myFeature',

  // pass context directly only
  { userId: '123' },
)
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="7,11-13,16-22,33" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  // ...

  // optional initial context
  context: { browser: 'chrome' },
})

// set more context later (append)
f.setContext({
  userId: '123',
})

// replace currently set context entirely
f.setContext(
  {
    userId: '123',
    browser: 'firefox',
  },
  true, // replace
)

// already set context will be used automatically
const isFeatureEnabled = f.isEnabled('myFeature')

// you can still pass context directly
// for overriding specific attributes
const isFeatureEnabled = f.isEnabled(
  'myFeature',

  // still allows passing context directly
  { browser: 'edge' },
)
```

{% /column %}
{% /row %}

### Hooks {% label="New" labelType="success" %}

Hooks are a set of new APIs allowing you to intercept the evaluation process and customize it.

A hook can be defined as follows:

```ts {% title="Defining a hook" path="your-app/index.ts" %}
import { Hook } from "@featurevisor/sdk"

const myCustomHook: Hook = {
  // only required property
  name: 'my-custom-hook',

  // rest of the properties below are all optional per hook

  // before evaluation
  before: function (options) {
    const {
      type, // `feature` | `variation` | `variable`
      featureKey,
      variableKey, // if type is `variable`
      context
    } options;

    // update context before evaluation
    options.context = {
      ...options.context,
      someAdditionalAttribute: 'value',
    }

    return options
  },

  // after evaluation
  after: function (evaluation, options) {
    const {
      reason // `error` | `feature_not_found` | `variable_not_found` | ...
    } = evaluation

    if (reason === "error") {
      // log error

      return
    }
  },

  // configure bucket key
  bucketKey: function (options) {
    const {
      featureKey,
      context,
      bucketBy,
      bucketKey, // default bucket key
    } = options;

    // return custom bucket key
    return bucketKey
  },

  // configure bucket value (between 0 and 100,000)
  bucketValue: function (options) {
    const {
      featureKey,
      context,
      bucketKey,
      bucketValue, // default bucket value
    } = options;

    // return custom bucket value
    return bucketValue
  },
}
```

You can register the hook when creating SDK instance:

```js {% title="When creating instance" path="your-app/index.js" highlight="6" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  // ...

  hooks: [myCustomHook],
})
```

You can also register the hook after creating the SDK instance:

```js {% title="After creating instance" path="your-app/index.js" highlight="3,6" %}
const f; // Featurevisor SDK instance

const removeHook = f.addHook(myCustomHook)

// remove the hook later
removeHook()
```

### Intercepting context {% label="Breaking" labelType="error" %}

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="6-12" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  // ...

  interceptContext: function (context) {
    // modify context before evaluation
    return {
      ...context,
      someAdditionalAttribute: 'value',
    }
  },
})
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="6-19" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  // ...

  hooks: [
    {
      name: 'intercept-context',
      before: function (options) {
        // modify context before evaluation
        options.context = {
          ...options.context,
          someAdditionalAttribute: 'value',
        }

        return options
      },
    },
  ],
})
```

{% /column %}
{% /row %}

### Events {% label="Breaking" labelType="error" %}

All the known events from v1 SDK have been removed in v2 SDK:

- Readiness: see [fetching datafile](#fetching-datafile)
  - `onReady` option and method
  - `ready` event
- Refreshing: see [refreshing datafile](#refreshing-datafile)
  - `refresh` event and method
  - `startRefreshing` method
  - `stopRefreshing` method
  - `onRefresh` option
  - `update` event
  - `onUpdate` option
- Activation: see [activation](#activation)
  - `activate` event and method
  - `onActivate` option

A new set of events has been introduced which are more generic.

Because of these changes, reactivity is vastly improved allowing you to listen to the changes of specific features and react to them in a highly efficient way without having to reload or restart your application.

#### datafile_set {% label="New" labelType="success" %}

Will trigger when a datafile is set to the SDK instance:

```js {% path="your-app/index.js" highlight="3-10" %}
const f; // Featurevisor SDK instance

const unsubscribe = f.on("datafile_set", ({
  revision, // new revision
  previousRevision,
  revisionChanged, // true if revision has changed
  features, // list of all affected feature keys
}) => {
  console.log('Datafile set')
})

unsubscribe();
```

#### context_set {% label="New" labelType="success" %}

Will trigger when context is set to the SDK instance:

```js {% path="your-app/index.js" highlight="3-7" %}
const f; // Featurevisor SDK instance

const unsubscribe = f.on("context_set", ({
  replaced, // true if context was replaced
  context, // the new context
}) => {
  console.log('Context set')
})

unsubscribe();
```

#### sticky_set {% label="New" labelType="success" %}

Will trigger when sticky features are set to the SDK instance:

```js {% path="your-app/index.js" highlight="3-7" %}
const f; // Featurevisor SDK instance

const unsubscribe = f.on("sticky_set", ({
  replaced, // true if sticky features got replaced
  features, // list of all affected feature keys
}) => {
  console.log('Sticky features set')
})

unsubscribe();
```

### Child instance {% label="New" labelType="success" %}

It's one thing to deal with the same SDK instance when you are building a client-side application (think web or mobile app) where only one user is accessing the application.

But when you are building a server-side application (think a REST API) serving many different users simultaneously, you may want to have different SDK instances with user or request specific context.

Child instances make it very easy to achieve that now:

```js {% title="Primary instance" %}
import { createInstance } from '@featurevisor/sdK'

const f = createInstance({
  datafile: datafileContent,
})

// set common context for all
f.setContext({
  apiVersion: '5.0.0',
})
```

Afterwards, you can spawn child instances from it:

```js {% title="Child instance" highlight="3,9" %}
// creating a child instance with its own context
// (will get merged with parent context if available before evaluations)
const childF = f.spawn({
  userId: '234',
  country: 'nl',
})

// evaluate via spawned child instance
const isFeatureEnabled = childF.isEnabled('myFeature')
```

Similar to primary instance, you can also set context and sticky features in child instances:

```js {% title="Child instance: setting context" highlight="2,7" %}
// override child context later if needed
childF.setContext({
  country: 'de',
})

// when evaluating, you can still pass additional context
const isFeatureEnabled = childF.isEnabled('myFeature', {
  browser: 'firefox',
})
```

Methods similar to primary instance are all available on child instances:

- `isEnabled`
- `getVariation`
- `getVariable`
- `getVariableBoolean`
- `getVariableString`
- `getVariableInteger`
- `getVariableDouble`
- `getVariableArray`
- `getVariableObject`
- `getVariableJSON`
- `getAllEvaluations`
- `setContext`
- `setSticky`
- `on`

### Get all evaluations {% label="New" labelType="success" %}

You can get evaluation results of all your features currently loaded via datafile in the SDK instance:

```js {% path="your-app/index.js" %}
const f; // Featurevisor SDK instance

const allEvaluations = f.getAllEvaluations(context = {})

console.log(allEvaluations)
// {
//   myFeature: {
//     enabled: true,
//     variation: "control",
//     variables: {
//       myVariableKey: "myVariableValue",
//     },
//   },
//
//   anotherFeature: {
//     enabled: true,
//     variation: "treatment",
//   }
// }
```

This can be very useful when you want to serialize all evaluations, and hand it off from backend to frontend for example.

### Configuring bucket key {% label="Breaking" labelType="error" %}

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="4-14" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  configureBucketKey: function (options) {
    const {
      featureKey,
      context,

      // default bucket key
      bucketKey,
    } = options

    return bucketKey
  },
})
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="4-20" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  hooks: [
    {
      name: 'my-custom-hook',
      bucketKey: function (options) {
        const {
          featureKey,
          context,
          bucketBy,

          // default bucket key
          bucketKey,
        } = options

        return bucketKey
      },
    },
  ],
})
```

{% /column %}
{% /row %}

### Configuring bucket value {% label="Breaking" labelType="error" %}

{% row %}
{% column %}

```js {% title="Before" path="your-app/index.js" highlight="4-14" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  configureBucketValue: function (options) {
    const {
      featureKey,
      context,

      // default bucket value
      bucketValue,
    } = options

    return bucketValue
  },
})
```

{% /column %}
{% column %}

```js {% title="After" path="your-app/index.js" highlight="4-20" %}
import { createInstance } from '@featurevisor/sdk'

const f = createInstance({
  hooks: [
    {
      name: 'my-custom-hook',
      bucketValue: function (options) {
        const {
          featureKey,
          context,
          bucketKey

          // default bucket value
          bucketValue,
        } = options

        return bucketValue
      },
    },
  ],
})
```

{% /column %}
{% /row %}

Learn more in [JavaScript SDK](/docs/sdks/javascript/) page.

## React SDK usage

All the hooks are now reactive. Meaning, your components will automatically re-render when:

- a newew datafile is set
- context is set or updated
- sticky features are set or updated

Learn more in [React SDK](/docs/react/) page.

---

## Testing features

### sticky {% label="New" labelType="success" %}

Test specs of features can now also include sticky features, similar to SDK's API:

```yml {% path="tests/features/myFeature.spec.yml" highlight="9-14" %}
feature: myFeature

assertions:
  - description: My feature is enabled
    environment: production
    at: 100
    context:
      country: nl
    sticky:
      myFeatureKey:
        enabled: true
        variation: control
        variables:
          myVariableKey: myVariableValue
    expectedToBeEnabled: true
```

### expectedEvaluations {% label="New" labelType="success" %}

You can go deep with testing feature evaluations, including their evaluation reasons for example:

```yml {% path="tests/features/myFeature.spec.yml" highlight="10-20" %}
feature: myFeature

assertions:
  - description: My feature is enabled
    environment: production
    at: 100
    context:
      country: nl
    expectedToBeEnabled: true
    expectedEvaluations:
      flag:
        enabled: true
        reason: rule # see available rules in Evaluation type from SDK
      variation:
        variationValue: control
        reason: rule
      variables:
        myVariableKey:
          value: myVariableValue
          reason: rule
```

### children {% label="New" labelType="success" %}

Based on the new [child instance](#child-instance) API in SDK, you can also imitate testing against them via test specs:

```yml {% path="tests/features/myFeature.spec.yml" highlight="10-19" %}
feature: myFeature

assertions:
  - description: My feature is enabled
    environment: production
    at: 100
    context:
      apiVersion: 5.0.0

    children:
      - context:
          userId: '123'
          country: nl
        expectedToBeEnabled: true

      - context:
          userId: '456'
          country: de
        expectedToBeEnabled: false
```

Learn more in [Testing](/docs/testing/) page.
