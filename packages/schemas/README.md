# @featurevisor/schemas

Validate data in your application against schemas defined in your Featurevisor project and delivered in its datafiles. Rules such as how long a display name may be, or which countries checkout accepts, then change on the product's schedule, reviewed in pull requests, without a deploy.

Each schema comes as a [Standard Schema](https://standardschema.dev), so it plugs into tRPC, Hono, React Hook Form, TanStack Form and every other library that accepts one. Handles also give forms what they need to render: each field's title, placeholder and whatever else your project's annotations say, fields in order, choices with their labels, HTML attributes, reading form data, messages per kind of issue, and checks only your application can make.

This package is experimental: its API may change in a minor release.

**What you can build with it:**

- Sign up, checkout and settings forms whose limits, choices and wording change without a deploy ([Choices](#choices), [Annotations](#annotations)).
- The same rules in the browser and on the server, from one definition ([Validating](#validating), [Server actions](#server-actions)).
- Rules by market or by plan, such as a postcode per country or more seats on a business plan ([Recipes](#recipes)).
- A stricter rule rolled out to a share of users first, or relaxed during an incident by a kill switch ([Recipes](#recipes)).
- Checks between fields, such as a password typed twice or a booking that ends after it starts ([Rules between fields](#rules-between-fields)).
- Forms rendered from the schema itself, in order, with titles, placeholders and help text ([Rendering forms](#rendering-forms)).
- Reference data, such as countries with flags or plans with prices, shared by every form that needs it ([Reference data](#reference-data)).

## Contents

- [Installation](#installation)
- [A first schema, end to end](#a-first-schema-end-to-end)
- [Writing schemas](#writing-schemas)
- [Delivering schemas](#delivering-schemas)
- [Validating](#validating)
- [Issues](#issues)
- [Handles](#handles)
  - [Fields](#fields)
  - [Constraints](#constraints)
  - [Options](#options)
  - [Kinds](#kinds)
  - [Changes](#changes)
- [Annotations](#annotations)
  - [Built in annotations](#built-in-annotations)
  - [Your own annotations](#your-own-annotations)
  - [Where annotations go](#where-annotations-go)
  - [Reading annotations](#reading-annotations)
  - [Fields in order](#fields-in-order)
  - [Titles in messages](#titles-in-messages)
  - [Lint](#lint)
  - [Delivery](#delivery)
- [Choices](#choices)
  - [Two ways to write choices](#two-ways-to-write-choices)
  - [Reading choices](#reading-choices)
  - [What a choice holds](#what-a-choice-holds)
  - [What stays yours](#what-stays-yours)
  - [Choices in issues](#choices-in-issues)
  - [Reference data](#reference-data)
  - [Lint](#lint-1)
- [Messages](#messages)
  - [Templates](#templates)
  - [In the schema](#in-the-schema)
  - [In the application](#in-the-application)
  - [For one form](#for-one-form)
  - [Which message wins](#which-message-wins)
  - [Translating](#translating)
- [Checks in code](#checks-in-code)
- [Rules per environment](#rules-per-environment)
- [Rules under conditions](#rules-under-conditions)
  - [Conditions](#conditions)
  - [Comparing two fields](#comparing-two-fields)
  - [Nested mutations](#nested-mutations)
  - [In datafiles](#in-datafiles)
  - [At runtime](#at-runtime)
  - [What reads the base](#what-reads-the-base)
  - [For the values typed so far](#for-the-values-typed-so-far)
  - [Types](#types)
  - [Lint](#lint-2)
  - [By environment](#by-environment)
- [Rules between fields](#rules-between-fields)
  - [Conditions say when a value fails](#conditions-say-when-a-value-fails)
  - [For some users only](#for-some-users-only)
  - [Nested issues](#nested-issues)
  - [Common checks](#common-checks)
  - [How entries run](#how-entries-run)
- [Testing schemas](#testing-schemas)
- [Reading form data](#reading-form-data)
- [Server actions](#server-actions)
- [React](#react)
  - [`useSchema`](#useschema)
  - [`useValidation`](#usevalidation)
  - [`useSchemas` and `SchemasProvider`](#useschemas-and-schemasprovider)
  - [Form libraries](#form-libraries)
- [Rendering forms](#rendering-forms)
  - [A field by hand](#a-field-by-hand)
  - [A generic renderer](#a-generic-renderer)
  - [Rows of an array](#rows-of-an-array)
  - [Reference data](#reference-data-1)
  - [Without React](#without-react)
  - [Without JavaScript](#without-javascript)
- [Code generation](#code-generation)
- [Recipes](#recipes)
  - [A postcode per country](#a-postcode-per-country)
  - [Limits by plan](#limits-by-plan)
  - [A field another field makes required](#a-field-another-field-makes-required)
  - [A booking form](#a-booking-form)
  - [Roll out a stricter rule](#roll-out-a-stricter-rule)
  - [A kill switch](#a-kill-switch)
  - [Try a rule in staging first](#try-a-rule-in-staging-first)
  - [The same rules on the server](#the-same-rules-on-the-server)
  - [Choices that change without a deploy](#choices-that-change-without-a-deploy)
- [API reference](#api-reference)
  - [`@featurevisor/schemas`](#featurevisorschemas-1)
  - [`@featurevisor/schemas/react`](#featurevisorschemasreact)
- [How values are checked](#how-values-are-checked)
- [Changing a delivered schema](#changing-a-delivered-schema)
- [Not yet](#not-yet)

## Installation

```bash
npm install @featurevisor/sdk @featurevisor/schemas
```

The React entry, `@featurevisor/schemas/react`, also needs `react` and `@featurevisor/react`:

```bash
npm install @featurevisor/react
```

## A first schema, end to end

A sign up form whose name length and countries change without a deploy. In your Featurevisor project, declare the tag your web app's datafile selects, and turn on condition expressions:

```js
// featurevisor.config.js
module.exports = {
  tags: ["web"],
  environments: ["staging", "production"],
  conditionExpressions: true,
};
```

Write the schema, tagged for the web app:

```yml
# schemas/signUp.yml
description: A sign up form

tags:
  - web

type: object

properties:
  email:
    type: string
    pattern: "^[^@\\s]+@[^@\\s]+$"
    annotations:
      title: Email address
  displayName:
    type: string
    minLength: 2
    maxLength: 40
    annotations:
      title: Display name
  country:
    type: string
    enum: [GB, NL]
    annotations:
      title: Country

required: [email, displayName, country]
```

Let the web app's target deliver it:

```yml
# targets/web.yml
description: Web app

tag: web
```

Say what it accepts in a spec, then check, test and build as for flags:

```yml
# tests/schemas/signUp.spec.yml
schema: signUp

assertions:
  - description: A complete sign up passes
    environment: production
    value:
      email: user-1@example.com
      displayName: Ada
      country: NL
    expectedToBeValid: true

  - description: A one letter name is too short
    environment: production
    value:
      email: user-1@example.com
      displayName: A
      country: NL
    expectedIssues:
      - path: [displayName]
        code: minLength
```

```bash
npx featurevisor lint
npx featurevisor test
npx featurevisor build
```

`datafiles/production/featurevisor-web.json` now carries the schema. Deploy the datafiles as you deploy them for flags, then validate in the app with the instance it already has:

```ts
import { createFeaturevisor } from "@featurevisor/sdk";
import { createSchemas } from "@featurevisor/schemas";

const datafile = await fetch("https://cdn.example.com/production/featurevisor-web.json").then(
  (response) => response.json(),
);

const f = createFeaturevisor({ datafile });
const s = createSchemas(f);

s.validate("signUp", { email: "ada@example.com", displayName: "A", country: "NL" }).issues;
// [{ path: ["displayName"], code: "minLength", message: "Value at \"displayName\" must be ...", ... }]
```

A server checks the same rules on the data it receives, with `s.parse`, and `formAction` reads a submitted form ([Server actions](#server-actions)). To let Germans sign up next week, add `DE` to the `enum` in a pull request. Once it merges and the datafile is deployed, every app accepts it, with no release.

## Writing schemas

A schema file describes one value with the keywords variables use, a subset of JSON Schema (see [Schemas](https://featurevisor.com/docs/schemas/) in the Featurevisor docs). An order shows most of them:

```yml
# schemas/order.yml
description: An order placed at checkout

tags:
  - web

type: object

properties:
  items:
    type: array
    minItems: 1
    maxItems: 20
    items:
      type: object
      properties:
        sku:
          type: string
          pattern: "^[A-Z0-9-]+$"
        quantity:
          type: integer
          minimum: 1
          maximum: 9
      required: [sku, quantity]
  couponCode:
    schema: couponCode
  giftMessage:
    oneOf:
      - type: string
        maxLength: 200
      - const: null
  tags:
    type: array
    uniqueItems: true
    items:
      type: string
  notes:
    type: object
    additionalProperties:
      type: string
      maxLength: 500
  deliverAfter:
    type: string
    format: date-time

required: [items]
```

An order of 12 of one item, a coupon code of the wrong shape and a tag given twice reports three issues at once, at `items.0.quantity`, `couponCode` and `tags`.

| Keyword                                       | Describes                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `type`                                        | `string`, `integer`, `number`, `boolean`, `object` or `array`           |
| `properties`, `required`                      | An object's keys, and the ones that must be present                     |
| `additionalProperties`                        | Any other key, with one schema for every value, or `true` for any value |
| `items`                                       | Every item of an array, which `type: array` needs                       |
| `schema`                                      | Another schema, by key, such as `couponCode`                            |
| `oneOf`                                       | One of two or more shapes, such as a nullable field with `const: null`  |
| `enum`, `const`                               | The values allowed                                                      |
| `minimum`, `maximum`                          | A number's range                                                        |
| `minLength`, `maxLength`, `pattern`, `format` | A string's length, its shape, and `date-time` or `semver`               |
| `minItems`, `maxItems`, `uniqueItems`         | An array's size, and no item twice                                      |

Beside its rules, a schema file holds what only schema files have:

| Field                               | Where        | What it holds                                                                                                      |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `description`                       | Any node     | Notes for the people who maintain it, which never reach a datafile                                                 |
| `tags`                              | The root     | The targets that deliver it (see [Delivering schemas](#delivering-schemas))                                        |
| `metadata`                          | The root     | An owner and deadlines, as features have them (see [Metadata](https://featurevisor.com/docs/metadata/))            |
| `promotable`                        | The root     | `false` keeps a set's copy out of [promotions](https://featurevisor.com/docs/promotions/)                          |
| `annotations`                       | Any node     | Titles, placeholders and your own vocabulary (see [Annotations](#annotations))                                     |
| `annotationsSchema`, `optionSchema` | The root     | The vocabularies of annotations and choices (see [Choices](#choices))                                              |
| `messages`                          | Any node     | Wording per issue code, and per field on an object (see [Messages](#messages))                                     |
| `mutations`                         | Any node     | Changes under conditions, at the root a list per environment (see [Rules per environment](#rules-per-environment)) |
| `issues`                            | Object nodes | Rules between fields (see [Rules between fields](#rules-between-fields))                                           |

- **A schema file is never `json`,** the type variables use for a string that holds JSON, since an application validates the values it has.
- **One file, two uses.** A global or feature variable can use a schema with `schema: order` too, as long as the schema neither varies by environment nor has mutations or issues.
- **The fine print**, such as how a nullable field picks its branch or how lengths are counted, is in [How values are checked](#how-values-are-checked).

## Delivering schemas

Schemas live in your project's `schemas` directory, one file per key. To reach an application, a schema has to be in the datafile it loads, and nothing is delivered unless you opt in.

Give a schema tags, from the tags your configuration declares:

```yml
# schemas/signUp.yml
description: A sign up form

tags:
  - web

type: object

properties:
  email:
    type: string
    pattern: "^[^@\\s]+@[^@\\s]+$"
  displayName:
    type: string
    minLength: 2
    maxLength: 40
  country:
    type: string
    enum: [GB, NL]

required: [email, displayName]
```

A target that selects by `tag` or `tags` delivers every schema whose tags match, as it does features and global variables. Targets also take `includeSchemas`, which delivers schemas whatever their tags, and `excludeSchemas`, which leaves them out, winning over both:

```yml
# targets/web.yml
description: Web app

tag: web

includeSchemas:
  - couponCode

excludeSchemas:
  - legacyAddress
```

| Target                             | Schemas in its datafile             |
| ---------------------------------- | ----------------------------------- |
| No selectors                       | None                                |
| `tag: web`                         | Every schema tagged `web`           |
| `tag: web` with `includeSchemas`   | Those, and the listed ones          |
| `includeFeatures` only             | None                                |
| `includeSchemas` only              | The listed ones                     |
| Any of these with `excludeSchemas` | The same, without the excluded ones |

A delivered schema brings every schema it references with `schema`, at any depth, even an excluded one, so each can be validated on its own. Datafiles then gain a `schemas` section, with the rules, messages and annotations as written, and a `hash` for each schema that covers the schemas it references. A target that delivers no schema keeps its datafile exactly as it was.

A target that only serves a backend, which validates but renders nothing, can leave annotations out with `includeAnnotations: false` (see [Annotations](#annotations)).

Lint checks that the patterns in `includeSchemas` and `excludeSchemas` match a schema, and that a target with `schemaVersion: "2"` delivers none. Applications test untrusted input against delivered schemas, so every `pattern` in one must also be a regular expression every SDK reads alike, with no risk of exponential backtracking.

## Validating

Create the instance from your SDK instance. By convention it is called `s`, as the SDK instance is `f`:

```ts
import { createFeaturevisor } from "@featurevisor/sdk";
import { createSchemas } from "@featurevisor/schemas";

const f = createFeaturevisor({ datafile });
const s = createSchemas(f);

const result = s.validate("signUp", input);

if (result.issues) {
  // show result.issues beside the form's fields
} else {
  // result.value is the input itself, unchanged
}
```

- The result is a Standard Schema result: `{ value }` with the input itself, never changed, or `{ issues }`. Validation never coerces, fills defaults or strips keys.
- `s.isValid(key, value)` returns a boolean.
- `s.parse(key, value)` returns the value itself, typed with generated types, or throws a `SchemaError`, for servers, scripts and workers that want a value or a stop.
- All three take a context as a third argument, merged over the instance's, for checks in code and messages.
- `s.keys()` lists the schemas the datafile has, and `s.has(key)` says whether it has one.
- The instance holds no copy of the schemas. Every call reads the datafile the SDK has now, so a new datafile takes effect at the next validation.

A key the datafile does not have fails closed, with one `schemaNotFound` issue, and the SDK reports a `schema_not_found` diagnostic once per key. A target that forgot to deliver a schema is noticed, rather than letting anything through. Validate once the SDK has its datafile, as you would evaluate flags.

A `SchemaError` is an `Error` with the schema's key in `schema`, the `issues`, and `flattened`, the issues by field as `flattenIssues` groups them, so one error handler can answer every bad request:

```ts
import { SchemaError } from "@featurevisor/schemas";

try {
  const order = s.parse("order", body);
  // order is the body, unchanged
} catch (error) {
  if (error instanceof SchemaError) {
    return Response.json(error.flattened, { status: 400 });
  }
  throw error;
}
```

## Issues

Every issue has a `message`, a `path` of object keys and array indices, the `code` of the keyword that failed, its `params`, and the `schema` validated:

```json
{
  "message": "Value at \"displayName\" must be at least 2 characters long (got 1).",
  "path": ["displayName"],
  "code": "minLength",
  "params": { "minLength": 2, "length": 1, "title": "Display name" },
  "schema": "signUp"
}
```

An issue whose rule a mutation set or changed also names it in `mutation`, such as `"mutation": "business"` for a tax ID only businesses must give (see [Rules under conditions](#rules-under-conditions)). When several matching mutations changed the rule, the last one names it.

Validation reports every issue it finds, so a form can mark every field at once.

| Code                     | Raised when                                                          | Params                                            |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------- |
| `type`                   | The value has another type                                           | `type`, `received`                                |
| `const`                  | The value is not the constant                                        | `const`                                           |
| `enum`                   | The value is not one of the listed values                            | `options`, and `titles` when every choice has one |
| `minimum`, `maximum`     | A number is out of range                                             | `minimum` or `maximum`, `value`                   |
| `minLength`, `maxLength` | A string is too short or too long                                    | `minLength` or `maxLength`, `length`              |
| `pattern`                | A string does not match                                              | `pattern`                                         |
| `format`                 | A string is not a timestamp or a version                             | `format`                                          |
| `minItems`, `maxItems`   | An array has too few or too many items                               | `minItems` or `maxItems`, `count`                 |
| `uniqueItems`            | An array repeats an item                                             | `index`, of the first repeat                      |
| `required`               | A key is missing                                                     | `key`                                             |
| `additionalProperties`   | An object has a key it does not allow                                | `key`                                             |
| `oneOf`                  | No branch matches, or more than one does                             | `matches`                                         |
| `refine`                 | A check in code returns false, or one of a schema's `issues` matches | `refine`, the check's or the entry's key          |
| `refineError`            | A check in code throws or rejects                                    | `refine`, the check's key                         |
| `schemaNotFound`         | The datafile has no such schema or field                             | `schema`, and `field` for a field                 |

Every issue about a field with a `title` annotation also carries it as `params.title`, so a message can name the field (see [Annotations](#annotations)). An `additionalProperties` issue has none, since its key has no field.

A `required` issue's path is the missing key's, such as `["address", "city"]`, and an `additionalProperties` issue's path is the extra key's, so a form shows both beside the field they are about.

`flattenIssues` groups messages by field, in the shape of Zod's `flattenError`, for showing them without a form library:

```ts
import { flattenIssues } from "@featurevisor/schemas";

flattenIssues(result.issues);
// {
//   formErrors: [],
//   fieldErrors: {
//     displayName: ['Value at "displayName" must be at least 2 characters long (got 1).'],
//   },
// }
```

## Handles

`s.get(key)` gives the schema's handle:

```ts
const signUp = s.get("signUp");

signUp["~standard"].validate(input); // the same result as s.validate("signUp", input)
```

A handle is stable, and reads the current datafile whenever it is used, so you can hand it to a library once, at start up, and still pick up every new datafile.

| Member                 | What it is                                                                    |
| ---------------------- | ----------------------------------------------------------------------------- |
| `["~standard"]`        | The Standard Schema interface                                                 |
| `key`                  | The schema's key, such as `signUp`                                            |
| `path`                 | Where a field's handle sits, such as `address.city`, or `""` for the schema   |
| `name`                 | Its own key, such as `city`, or `""` for the schema                           |
| `validate(value)`      | The same result as `s.validate`, with the handle's checks in code             |
| `isValid(value)`       | A boolean, and a type guard with generated types                              |
| `parse(value)`         | The value, or a thrown `SchemaError`                                          |
| `at(path)`             | The handle for one field, such as `at("displayName")` or `at("items[].name")` |
| `fields`               | An object's fields' handles, in its `order`                                   |
| `annotations`          | What the schema says beside the field's rules, such as its `title`            |
| `constraints`          | The HTML validation attributes its rules imply                                |
| `options`              | Its choices, as `{ value, title, ...fields }`                                 |
| `option(value)`        | One of its choices by value, for showing a value saved earlier                |
| `kind`                 | What its rules make the field, such as `text` or `select`                     |
| `fromFormData(data)`   | A value read from `FormData` or `URLSearchParams`                             |
| `subscribe(listener)`  | A call when a new datafile changes the schema                                 |
| `for(values, options)` | The same handle for the values typed so far, with the mutations that match    |
| `reads`                | The fields its mutations' and issues' conditions read                         |

### Fields

`at` takes a field name as form libraries write it: `address.city`, `items.0.name` or `items[0].name`. Since a schema describes every item of an array alike, `items[].name` means the same, and `labels.*` steps into the values of an object that allows any key. It follows references, and stops at `oneOf`. A field's handle reports issues with paths relative to the field, and a path the schema lacks fails closed with `schemaNotFound`. `fields` and `annotations` have [a section of their own](#annotations).

### Constraints

Constraints are named after HTML attributes, so they spread onto an input:

```ts
signUp.constraints;
// {
//   email: { required: true },
//   displayName: { required: true, minLength: 2, maxLength: 40 },
//   country: {},
// }

signUp.at("displayName").constraints; // { required: true, minLength: 2, maxLength: 40 }
```

| Attribute                | From                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `required`               | The key is in its object's `required`, and an input left empty fails |
| `minLength`, `maxLength` | The same keywords on a string                                        |
| `min`, `max`             | `minimum` and `maximum` on a number                                  |
| `step`                   | `1` for an `integer`                                                 |
| `multiple`               | An array, such as a multiple select                                  |

An input left empty fails only some fields: a nullable field reads it as `null`, an unchecked box as `false` and a required list with nothing chosen as `[]` (see [Reading form data](#reading-form-data)), so `required` is left out for those, unless `const: true` or `minItems` say otherwise. An object's constraints go by field path, through nested objects, such as `address.city`, and stop at arrays, whose rows have handles of their own, `at("items.0")`. Any other schema's constraints are its own, and a field's are its entry in its object's, `required` included, so `signUp.at("displayName").constraints` is `signUp.constraints.displayName`. `pattern` is left out, since a browser anchors and compiles patterns its own way, and validation still checks it. Browsers count `maxlength` in UTF-16 code units, which stops typing at an emoji sooner than the schema would, never later.

### Options

Options are the values an `enum`, a `const` or a `oneOf` of consts allows, in the order the schema lists them, each as an object with what the schema says about it (see [Choices](#choices)):

```ts
signUp.options.country; // [{ value: "GB", title: "United Kingdom" }, { value: "NL", title: "Netherlands" }]
signUp.at("country").options; // the same list
signUp.at("country").option("NL"); // { value: "NL", title: "Netherlands" }
```

An object's options go by field path, and an array's are its items', for a multiple select. A field without choices has none, so code writes `signUp.options.country ?? []`. A schema the datafile lacks has no constraints and an empty list of options, so `options.map` works before the datafile arrives. Constraints, options and annotations are frozen, since every caller shares them.

### Kinds

Every generic form writes the same switch over a field's rules, so `kind` answers it, from the rules alone. A project's own `input` annotation, or whatever it calls one, still wins.

| `kind`        | From                                                                |
| ------------- | ------------------------------------------------------------------- |
| `text`        | `type: string`                                                      |
| `date-time`   | `type: string` with `format: date-time`                             |
| `version`     | `type: string` with `format: semver`                                |
| `number`      | `type: integer` or `type: number`                                   |
| `boolean`     | `type: boolean`, or a choice between booleans such as `const: true` |
| `select`      | Any other `enum`, `const` or `oneOf` of consts                      |
| `multiselect` | An array whose items are choices                                    |
| `object`      | `type: object`                                                      |
| `list`        | Any other array                                                     |

A nullable field has its other branch's kind, so a nullable name is `text`. Any other `oneOf` has no kind, and `kind` is `undefined`.

### Changes

Code without hooks, such as a web component, renders again from `subscribe`, which calls back when a new datafile changes the schema, through a schema it references too, and returns a function that stops it. A field's handle follows its schema, and `s.close()` stops every listener the instance started:

```ts
const country = s.get("signUp").at("country");

const stop = country.subscribe(() => render(country.options));
```

## Annotations

Validation stays the same wherever a schema runs. A form needs more than validation: a title for each field, a placeholder, help text, which input to show, and the order fields come in. Annotations carry these beside a schema's rules, typed by your project and checked by lint, delivered with the schema and changed without a deploy. Validation never reads them, so removing every annotation changes no validation result.

```yml
# schemas/signUp.yml
description: A sign up form

tags:
  - web

annotationsSchema:
  schema: formAnnotations

type: object

properties:
  email:
    type: string
    pattern: "^[^@\\s]+@[^@\\s]+$"
    annotations:
      title: Email address
      placeholder: ada@example.com
      input: email
      autocomplete: email
      help: We send a link to confirm it
  displayName:
    type: string
    minLength: 2
    maxLength: 40
    annotations:
      title: Display name
      examples: [Ada, Grace Hopper]
  address:
    schema: address
    annotations:
      title: Billing address

required: [email, displayName]

annotations:
  title: Create your account
  submitLabel: Sign up
  order: [displayName, email, address]
```

### Built in annotations

Four annotations need no vocabulary, since Featurevisor uses them itself. They work in every schema file, with or without an `annotationsSchema`, so you never declare them, and a vocabulary that tries to fails lint, so no project can give them another meaning:

| Annotation | Must be                                                             | Featurevisor uses it for                                                                       |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `title`    | Text                                                                | `params.title` on every issue about the field, and choices' `titles` (see [Choices](#choices)) |
| `examples` | A list of values, each passing the field's own rules                | Lint only, for now. Read it from `annotations` for placeholders or docs                        |
| `order`    | On an object, a list of its own field names, each once              | `fields` (see [Fields in order](#fields-in-order))                                             |
| `options`  | Beside an `enum`, a map from each value to what that choice carries | `options` and `option(value)` (see [Choices](#choices))                                        |

**Written wrong, lint stops it** before it reaches a datafile:

| Written                                  | Lint says                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `order` declared in `annotationsSchema`  | `` `order` is built in, so `annotationsSchema` cannot declare it. ``                                                                 |
| `order: city`, not a list                | `` `order` must be a list of field names. ``                                                                                         |
| `order` on a field that is not an object | `` `order` lists an object's fields, and this node has no `properties`. ``                                                           |
| `order: [emial]`, or a number            | `` `order` names emial, which is not a field here. Fields: email, displayName, address. ``                                           |
| `order: [email, email]`                  | `` `order` names email twice. ``                                                                                                     |
| `title: 42`, or an empty title           | `` `title` must be text. ``                                                                                                          |
| `examples: [1]` on a string field        | `Example 1 does not pass the field's own rules.`                                                                                     |
| `options` beside anything but an `enum`  | `` `options` goes beside an `enum`, keyed by its values. A `oneOf` of consts gives each choice its annotations in its own branch. `` |

An `order` that lists only some fields is fine, and an `order` beside a `schema` reference is checked against the referenced object's fields.

**If a wrong one reaches an application anyway**, from a datafile Featurevisor did not build, the package uses what it can and ignores the rest, so nothing breaks:

- `fields` skips names that are not fields, numbers and repeats, ignores an `order` that is not a list, and still returns every field once. `order: [c, 1, nope, c, a]` gives `c, a, b`.
- A `title` that is not text never reaches an issue's params.
- An `options` that is not a map, or an entry that is not one, gives choices with nothing but their values.
- `annotations` returns every annotation as written, so code that reads `annotations.order` itself sees exactly what the datafile holds. Follow the order through `fields`, which is always safe.

`description` stays for the people who maintain a schema and never reaches a datafile. Help text for the people filling in a form is your own annotation, such as `help`, so the two never mix.

### Your own annotations

Featurevisor ships no form vocabulary of its own, so nothing locks a project into a shape. A schema names what else its annotations can hold with `annotationsSchema` at its root: one object schema, written inline or referenced by key, whose properties are the annotation names:

```yml
# schemas/formAnnotations.yml
description: What our forms say about a form and its fields

type: object

properties:
  placeholder:
    type: string
  help:
    type: string
  input:
    type: string
    enum: [text, email, password, textarea, select, radio, checkbox]
  autocomplete:
    type: string
  hidden:
    type: boolean
  submitLabel:
    type: string
```

- **Closed, so typos fail.** An object with `properties` rejects names it does not list, so `placeholdr` fails lint. A vocabulary that wants to stay open says `additionalProperties: true`.
- **Every node in the file.** The vocabulary covers the root and every field the file describes. A referenced schema such as `address` uses its own, so one form can mix vocabularies. A schema without one carries only the built in annotations.
- **Optional unless you say otherwise.** Every property is optional, since `submitLabel` suits a form and `placeholder` a field, and one object schema cannot tell them apart. A name you list in the vocabulary's `required` must then be on the schema itself and on every field, item and value a handle can reach in the file: everything `at` and `fields` reach, nothing inside a `oneOf`. A field beside a `schema` reference can carry it through the referenced schema's own annotations. So `required: [help]` makes lint fail any field without help text, from the form's root down.
- **Never the built in names.** A vocabulary cannot declare `title`, `examples`, `order` or `options`.
- **Never in a datafile.** Lint has checked every annotation against the vocabulary, so only the annotations travel.
- **Families of schemas.** Web forms, mobile forms, a back office and CMS content can each have a vocabulary, and a schema that only checks API bodies needs none.

### Where annotations go

`annotations` sit beside a node's rules: at a schema's root, on any field, in `items`, in a `oneOf` branch, and beside a `schema` reference.

Beside a reference, they apply to that use of the referenced schema only, over its own. Above, `address` keeps the title and `order` its own file gives it, and this form titles it "Billing address". A field beside a reference can reorder the referenced schema's fields the same way, with its own `order`.

Unlike `messages`, annotations are never keyed by field at the object level. Their values can be objects, such as `options`, so a map could not tell a field from a value, and a field named `title` would meet the `title` annotation.

### Reading annotations

A handle's `annotations` are its node's own, frozen:

```ts
const signUp = s.get("signUp");

signUp.annotations; // { title: "Create your account", submitLabel: "Sign up", order: [...] }
signUp.at("email").annotations.placeholder; // "ada@example.com"
signUp.at("address").annotations.title; // "Billing address"
s.get("address").annotations.title; // the address schema's own title
```

A schema or field the datafile lacks has none, `{}`. The same handle reads the same way in vanilla JavaScript, React, a page rendered on a server, or a worker.

### Fields in order

`fields` gives an object's fields' handles with the fields its `order` lists first, in that order, and then the fields it leaves out, in no particular order. List every field when the whole sequence matters. Without an `order`, every field comes in no particular order. `order` is built in, so it needs nothing in `annotationsSchema` (see [Built in annotations](#built-in-annotations)). Each field's handle has its `name`, its own key, and its `path`, the name form libraries, issues and `flattenIssues` all use, so a renderer never maps one name to another:

```ts
signUp.fields.map((field) => field.path); // ["displayName", "email", "address"]

signUp.at("address").fields.map((field) => field.path);
// ["address.street", "address.city", "address.postcode"]
```

- A field from `fields` is the same handle `at` gives, and the list is the same array until a datafile changes the schema.
- An object field, such as `address`, has fields of its own, in its own `order`. Any other value has none, `[]`, and so does a nullable object, since `at` stops at `oneOf`.
- Rows of an array are data, not schema, so they come from your form library, with `at(index)` for each row's handle, whose `fields` are the row's (see [Rendering forms](#rendering-forms)).
- `order` is the sequence and nothing else. Whether a field shows, which section it sits in, or which step of a wizard asks for it belongs to your vocabulary, such as `hidden`, so neither does the other's job.

Order is a list, never the order keys are written in, since JavaScript moves a key such as `2024` to the front of an object, Go and Swift keep no key order at all, and formatting tools can reorder keys without anyone meaning to change a form. That is also why the fields `order` leaves out come in no particular order: an SDK on any platform can keep the promise.

### Titles in messages

Every issue about a field with a `title` carries it in `params.title`, so one message words every form:

```ts
const s = createSchemas(f, {
  messages: {
    required: ({ title, key }) => `${title ?? key} is required`,
    minLength: "{title} needs at least {minLength} characters",
  },
});
```

A template fills `{title}` with nothing when a field has no title, so a function that falls back, as `required` does above, suits schemas where not every field has one. A field's title comes from beside a reference first, then from the referenced schema.

### Lint

Lint checks every annotation in a schema file:

- each name is built in or declared by the vocabulary, and each value matches the vocabulary's rules for it, so `placeholdr` or a `placeholder: 3` fails,
- each name the vocabulary lists in `required` is on the schema and on every field, item and value a handle reaches, or lint says `` `annotationsSchema` requires `help`, which this node does not have. ``,
- the built in annotations have the shapes [above](#built-in-annotations),
- `options` keys name the `enum`'s values, and its entries fit `optionSchema` (see [Choices](#choices)),
- the vocabularies are object schemas that leave the built in names alone.

### Delivery

Datafiles carry annotations inside each schema, as written, and a schema's `hash` covers them, so a change of wording makes the SDK's `datafile_set` event name the schema, `subscribe` call back and `useSchema` render again.

A target that serves only a backend leaves annotations out, which keeps its datafiles small:

```yml
# targets/api.yml
description: Our API

tag: web

includeAnnotations: false
```

Its applications still validate the same, since validation never reads annotations, but their issues carry no titles.

The Catalog shows a schema's annotations on its Overview: the root's above the structure, and each field's in an Annotations column of the structure table, choices one a line.

## Choices

A choice needs more than its value: a label, a flag, a region, a price, a badge. Every choice can carry a built in `title`, and whatever the schema's `optionSchema` declares. `optionSchema` sits at the root, inline or by reference, as `annotationsSchema` does, and follows the same rules: one object schema, closed, per file, never in a datafile:

```yml
# schemas/countryOption.yml
description: What a country choice carries

type: object

properties:
  flag:
    type: string
  region:
    type: string
    enum: [europe, americas]
  hidden:
    type: boolean
```

A field has a placeholder and an input, and a choice has a flag and a region, so each vocabulary stays closed and precise. `optionSchema` cannot declare `title`, which is built in, or `value`, which holds the choice itself. Without one, a schema's choices carry only titles.

**What a choice can carry** is anything a schema describes: text, numbers, an `enum` such as `region`, a list, or an object, such as a price:

```yml
# schemas/planOption.yml
description: What a plan choice carries

type: object

properties:
  price:
    type: object
    properties:
      amount:
        type: number
      currency:
        type: string
        enum: [EUR, GBP, USD]
    required: [amount, currency]
  features:
    type: array
    items:
      type: string
  tone:
    type: string
    enum: [grey, blue, gold]

required: [price]
```

Lint checks each entry with the same rules it checks variables with. A vocabulary that stays open says `additionalProperties: true`.

**Required fields.** Every field is optional unless the vocabulary lists it in `required`, as `price` is above. Every value of every `enum` in the file then needs an entry with it in `options`, and every branch of a `oneOf` of consts needs it in its own annotations, so a renderer can rely on every plan having a price. Two kinds of choice carry no entry, so `required` never reaches them: the one value of a field that is a single `const`, and the `null` of a nullable field written as a `oneOf` with `const: null`.

**One vocabulary per file.** Every list of choices in a file shares its `optionSchema`. A list whose choices carry fields of their own, such as countries with flags beside plans with prices, makes a schema of its own, with its own `optionSchema`, which forms reference (see [Reference data](#reference-data)).

### Two ways to write choices

Beside an `enum`, under the built in `options` annotation, keyed by value:

```yml
# schemas/signUp.yml
optionSchema:
  schema: countryOption

properties:
  country:
    type: string
    enum: [GB, NL, BE]
    annotations:
      title: Country
      input: select
      options:
        GB:
          title: United Kingdom
          flag: gb
          region: europe
        NL:
          title: Netherlands
          flag: nl
          region: europe
        BE:
          title: Belgium
          hidden: true
```

Or as a `oneOf` of `const` branches, each with its own `annotations`, the way JSON Schema itself labels values:

```yml
# schemas/country.yml
description: Countries we sell to

optionSchema:
  schema: countryOption

oneOf:
  - const: GB
    annotations:
      title: United Kingdom
      flag: gb
  - const: NL
    annotations:
      title: Netherlands
      flag: nl
  - const: null
    annotations:
      title: Prefer not to say
```

| Written as                        | Suits                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `enum` with `annotations.options` | Short lists of plain values, as most schemas write them                                            |
| `const` branches of a `oneOf`     | Choices that come and go with their wording, a labelled `null`, and schemas from JSON Schema tools |

- **Keys of `options`** are the values themselves, or, for a value that is not text, its JSON text: `1`, `true` or `null`, which is how YAML reads such keys. Lint rejects a key that names no value, and one that would name two, such as `"1"` beside `1` in one `enum`.
- **Partial is fine.** A value without an entry is a choice like any other, so annotating one value for a badge is normal.
- **Order is the rules'.** Choices come in the order of the `enum` or of the branches, never of the map.
- **A `oneOf` of consts is a list of choices.** A value it does not list reports `enum`, as an `enum` does, its branches' annotations are its choices', and lint rejects a value given twice. In any other `oneOf`, such as a nullable field's, a branch's annotations are a field's.

### Reading choices

`options` lists the choices in order as flat objects, `{ value, title, ...fields }`, and `option(value)` finds one by value, comparing objects by value, for showing a value saved earlier:

```ts
const country = s.get("signUp").at("country");

country.options;
// [
//   { value: "GB", title: "United Kingdom", flag: "gb", region: "europe" },
//   { value: "NL", title: "Netherlands", flag: "nl", region: "europe" },
//   { value: "BE", title: "Belgium", hidden: true },
// ]

country.option("GB")?.title; // "United Kingdom"
country.option("FR"); // undefined
```

A plain `enum` without entries gives `[{ value }]`, so a renderer has one path for every list. An array's choices are its items', for a multiple select or a group of checkboxes, so `options` beside an array's `items` labels them.

### What a choice holds

A choice is a flat object, and it only ever holds `value`, `title` and your vocabulary's fields. Featurevisor never adds another name to it: anything it works out about a choice later goes on the handle instead, so no field of yours is ever shadowed. A new built in name on choices, or on the four built in annotations, would be a breaking change. For the same reason, `value` and `title` keep Featurevisor's types whatever a vocabulary's type says.

### What stays yours

Featurevisor computes no label and filters nothing. `hidden`, `disabled`, grouping, icons and prices are your vocabulary's, and so is the language of a title, which can be text or a key for your own translations, so any i18n setup fits:

- `option.title ?? String(option.value)` shows a value that has no title, and says so in code.
- A hidden choice is still accepted, for data saved before it was retired. Removing it from the `enum` stops validation accepting it.

### Choices in issues

When every choice has a title, an `enum` issue carries them in `params.titles`, beside the values in `params.options`, and the default message names the titles, since those are what a person picks from:

```text
Value at "country" must be one of United Kingdom, Netherlands, Belgium.
```

### Reference data

A list such as `country` makes a schema of its own, with its own `optionSchema`, and forms reference it, each with its own title beside the reference:

```yml
properties:
  shippingCountry:
    schema: country
    annotations:
      title: Ship to
```

One component then serves every form that references it (see [Rendering forms](#rendering-forms)).

### Lint

Lint checks each entry against `optionSchema` and the built in `title`, each key against the `enum`, every choice for the fields `optionSchema` lists in `required`, and each list of consts for values given twice. It warns with `option_without_title` when some of a field's choices have a title and others do not, since a list would show titles beside raw values.

| Written                                                    | Lint says                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| An `enum` value without an entry, when `price` is required | `` `optionSchema` requires `price`, and the choice team has no entry in `options`. ``  |
| An entry or a `const` branch without `price`               | `` `optionSchema` requires `price`, which this choice does not have. ``                |
| `value` in `optionSchema`                                  | `` `value` holds each choice's own value, so `optionSchema` cannot declare it. ``      |
| `value` in a choice's entry                                | `` `value` is the choice's own value, so a choice cannot set it. ``                    |
| A name `optionSchema` does not declare                     | ``Unknown choice field `colour`. `optionSchema` declares `flag`, `region`, `hidden`.`` |

## Messages

Every issue carries a message, which a schema, your application and one form can each choose.

### Templates

Templates fill placeholders in braces from the issue's params: `Use at least {minLength} characters`, or `{title} is required`. Lists are joined with commas, and `{{` and `}}` write literal braces.

### In the schema

`messages` beside an object's `properties` word its fields. A text value is a message for an issue code, and a map is a field. `"[]"` holds the messages of an array's items, and `"*"` those of the values an open object allows:

```yml
messages:
  additionalProperties: "{key} is not part of a sign up"
  email:
    required: Tell us your email address
    pattern: Enter an email like ada@example.com
  displayName:
    minLength: Use at least {minLength} characters
  address:
    city:
      required: Which city should we deliver to?
  items:
    "[]":
      quantity:
        minimum: Order at least {minimum}
```

A map can reach into a referenced schema, as `address.city` does, and that wording applies to this schema's use of it only. A node can also carry `messages` beside its own rules, keyed by code, which is how a reusable or standalone schema words its issues, and the one field that may sit beside a `schema` reference:

```yml
# schemas/couponCode.yml
description: A coupon code

type: string

pattern: "^[A-Z0-9]{8}$"

messages:
  pattern: Enter the 8 letters and digits printed on the coupon
```

Messages reach the datafile with the schema. Lint checks that each text key is an issue code, each map key a field, and each placeholder a param of its code, `title` included. It warns about a message that can never show, such as `maxLength` for a number, or anything but `enum` beside a `oneOf` of consts, and about a field and code worded both beside the rule and in an enclosing object's `messages`, where the outer one wins.

### In the application

`messages` on `createSchemas` gives a message per code for every schema, as a template or a function of the params:

```ts
const s = createSchemas(f, {
  messages: {
    required: "This field is required",
    maxLength: ({ maxLength, length }) => `${length} of ${maxLength} characters`,
  },
});
```

### For one form

A second argument to `s.get` takes messages in the shape a schema's take:

```ts
const leaderboardMessages = {
  messages: {
    displayName: {
      maxLength: "Names on the leaderboard fit {maxLength} characters",
    },
  },
};

const leaderboardSignUp = s.get("signUp", leaderboardMessages);
```

The same options object gives the same handle, so define it once, outside a component.

### Which message wins

For each issue, the first of these that words it wins:

1. A check in code's own `message`, then the form's message for the issue's field.
2. The schema's, looked for from the outside in, so the outermost object that words the field wins, then the `message` of an entry in the schema's [`issues`](#rules-between-fields).
3. The application's, from `messages` on `createSchemas`.
4. The default, in English.

A message is for the field it names, never for the fields inside it. An extra key has no field of its own, so its message comes from the object that rejected it.

### Translating

`message` on `createSchemas` gets each issue, with the chosen message, and the context, and returns the message the issue carries. Returning `undefined` keeps the chosen one:

```ts
const s = createSchemas(f, {
  message: (issue, { context }) => t(issue.message, { ...issue.params, lng: context.locale }),
});
```

A schema can hold translation keys instead of text, such as `maxLength: signUp.displayName.tooLong`, for this function to translate. Titles and choices' titles can be keys too, which your components translate as they render them.

## Checks in code

Some checks need your application, such as whether a username is free. Give them to a handle with `refine`, each with a `key`, a `path`, a `check` and a `message`:

```ts
const signUp = s.get("signUp", {
  refine: [
    {
      key: "usernameAvailable",
      path: "username",
      check: async (username, { signal }) => {
        const response = await fetch(`/api/usernames/${encodeURIComponent(username)}`, { signal });
        const { available } = await response.json();

        return available;
      },
      message: "That username is taken",
    },
  ],
});

const result = await signUp.validate(input);
```

- **What `check` gets.** The value at its path, and `{ input, context, signal }`: the whole value being validated, the context, and an `AbortSignal`, always present, to hand to `fetch`. It returns `true` when the value passes, or a promise of it.
- **Its path.** Any path `at` takes, from the handle's root. With `[]` or `*` it runs for every item or value, such as `contacts[].email`, each issue at its item's path. Without a path, it checks the whole value.
- **When it runs.** After the schema's rules, and only when nothing at or inside its path has an issue already, so a username that is too short never reaches your API. `reads` names other fields whose issues hold it back too, such as `reads: ["items"]` for a total worked out from the items. The checks that run start together.
- **Its issue** has `code: "refine"` and `params: { refine: "usernameAvailable" }`, with the field's `title` when it has one, never the value checked. Its own `message` comes first, then the lookup goes on as for any issue, so a schema can word it with `username: { refine: "..." }`.
- **A check that fails to run**, by throwing or rejecting, gives a `refineError` issue, and validation fails closed. A check that should let a value through when it fails catches its own error and returns `true`.
- **Synchronous or not.** With synchronous checks, the handle stays synchronous, even with an aborted signal. Once a check returns a promise, `validate` and `isValid` return one, typed as Standard Schema's own result or a promise of it. Aborting the `signal` given to `validate` rejects it with the signal's reason.
- **A field's handle** carries the checks at or inside its path that read nothing else, relative to the field. A check on `items[].name` runs in `at("items.0.name")`'s handle, and one on `labels.*` in `at("labels.en")`'s.

What a handle checks is fixed when it is created, so `~standard.validate(value)` alone runs your checks too, and every Standard Schema library gets them. A library can pass a signal or a context through `libraryOptions`.

The instance keeps no answers and cancels nothing, since a server shares handles across requests. On the server, give the same check its own implementation under the same key, such as a database lookup, so its issue and message match the browser's. React's hooks keep answers, below.

## Rules per environment

A schema's rules can change one environment at a time, as you roll out a feature: a longer display name in dev first, then staging, then production, each step reviewed before the next. In a project with environments, a schema's root lists its `mutations` by environment, as a feature lists its rules and a global variable its overrides. Each mutation has a `key`, `conditions` and a `mutate`, which changes the schema's own fields, its base, in the notation global variable overrides use:

```yml
# schemas/signUp.yml
description: A sign up form

tags:
  - web

type: object

properties:
  displayName:
    type: string
    maxLength: 40
  country:
    type: string
    enum: [GB, NL]

required: [displayName]

mutations:
  dev:
    - key: longerNames
      conditions: "*"
      mutate:
        properties.displayName.maxLength: 60
        properties.country.enum:append: DE

  staging:
    - key: longerNames
      conditions: "*"
      mutate:
        properties.displayName.maxLength: 60

  production: []
```

Dev accepts names up to 60 characters and German sign ups, staging the longer names only, and production, whose list is empty, keeps the base. A rollout is then a series of small pull requests: add the mutation under `dev`, then under `staging`, then write the change into the base and remove the mutations. Mutations whose conditions depend on who is asking or what was typed, such as a tax ID only businesses must give, go in the same lists (see [Rules under conditions](#rules-under-conditions)).

| Entry in `mutate`                                     | In that environment                 |
| ----------------------------------------------------- | ----------------------------------- |
| `properties.displayName.maxLength: 60`                | Names up to 60 characters           |
| `properties.country.enum:append: DE`                  | One more country                    |
| `required:appendUnique: country`                      | A country is required               |
| `properties.nickname: { type: string }`               | A new optional key                  |
| `properties.country:remove: true`                     | The key is no longer accepted       |
| `properties.displayName.messages.maxLength: Up to 60` | Its own wording in that environment |

- **Applications validate against the same key everywhere.** Each environment's datafile holds the schema with its own list, so `s.validate("signUp", input)` gives dev's rules in dev and production's in production. A change to one environment's list changes the schema's `hash` in that environment's datafile only.
- **`*` applies when the datafile is built.** Mutations whose conditions are `"*"`, before any with other conditions, are applied when the environment's datafile is built, so it holds the changed rules. A handle's `constraints` and generated types read them as the base, and their issues name no mutation. The rest apply, in order, when a value is validated.
- **Inheritance.** Lists inherit as rules do: with `inheritEnvironments: { dev: { from: "staging" } }`, a schema that lists nothing for `dev` uses staging's list. `dev: []` lists none and inherits nothing, and an environment that lists nothing and inherits nothing has no mutations at the root.
- **Only at the root.** A field's own mutations inside a file are a list, which applies in every environment, and a reusable schema such as `address` lists its own root mutations by environment. In a project without environments, the root lists its mutations directly, `mutations: [...]`.
- **Lint** checks that each key is a configured environment and checks each list as it checks any mutations: every path reaches into the base, since a mutation creates no objects on the way, and the schema stays valid with each mutation alone and with the whole list, naming the mutation: `With mutation "longerNames", the schema fails: ...`. Delivered patterns a mutation sets get the same safe pattern checks as the base's.
- **Variables cannot use a schema that varies**, at their root or anywhere inside, since a variable's schema, values and type stay the same in every environment. Lint fails at the variable.
- **Generated types** come from production's version: the environment whose name starts with `prod`. `generate-code --environment=dev` types dev's version instead. A widening change in dev, such as a new `enum` value, is not in production's types, so release regenerated types before such a change reaches production (see [Changing a delivered schema](#changing-a-delivered-schema)). Mutations are typed as [under conditions](#rules-under-conditions) says.

## Rules under conditions

Some rules hold only under conditions: a tax ID that businesses must give, a seat limit per plan, a stricter rule rolled out to a percentage of users first, a kill switch that relaxes a rule during an incident. Any node of a schema can carry `mutations`, each with a `key`, `conditions` and a `mutate` in the same notation, and every mutation whose conditions match applies, in order, when a value is validated. At the root of a schema in a project with environments, they are listed by environment, and the examples here list production's.

Conditions in this README are written as [condition expressions](https://featurevisor.com/docs/conditions/), which read like the rule they state and need `conditionExpressions: true` in `featurevisor.config.js`. Every one has a tree form too, shown in the table below, for projects that write trees:

```yml
# schemas/signUp.yml
description: A sign up form

type: object

properties:
  accountType:
    type: string
    enum: [personal, business]
  displayName:
    type: string
    maxLength: 40
  taxId:
    type: string

required: [accountType, displayName]

mutations:
  production:
    - key: business
      conditions: input('accountType') == 'business'
      mutate:
        required:appendUnique: taxId
        properties.taxId.pattern: "^[A-Z]{2}[0-9]{9}$"
        properties.taxId.messages:
          pattern: Enter your VAT number, such as DE123456789

    - key: payingAccounts
      conditions: payingAccounts
      mutate:
        properties.displayName.maxLength: 80

    - key: strictNames
      conditions: feature('strictNames')
      mutate:
        properties.displayName.pattern: "^[A-Za-z ]+$"
```

A business account needs a tax ID in the right shape, with its own message, paying accounts get longer names, and a stricter pattern reaches the users the `strictNames` feature is enabled for, so it can roll out by percentage like any change.

### Conditions

Conditions are the ones features and global variables use, so a segment means the same in a schema as in a flag:

| Reads                                                        | Expression                              | Tree                                                                   |
| ------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------- |
| An attribute of the context                                  | `plan == 'paid'`                        | `{ attribute: plan, operator: equals, value: paid }`                   |
| A segment, through its own conditions                        | `payingAccounts`                        | `payingAccounts`                                                       |
| A flag, through the SDK's getters, sticky values and modules | `feature('strictNames')`                | `{ feature: strictNames }`                                             |
| A global variable's value                                    | `variable('relaxedRules') == true`      | `{ variable: relaxedRules, operator: equals, value: true }`            |
| A field of the value being validated                         | `input('accountType') == 'business'`    | `{ input: accountType, operator: equals, value: business }`            |
| Two fields compared                                          | `input('confirm') == input('password')` | `{ input: confirm, operator: equals, valueFrom: { input: password } }` |

Join them with `and`, `or` and `not`, and group them with parentheses, so one condition can say who it is for and what the value holds: `payingAccounts and input('seats') > 10`.

- **`input` is the one addition.** It reads the value being validated, as Standard Schema calls it, so rules can depend on what was typed. Paths are relative to the node a mutation sits on, with dots into objects inside the quotes, `input('address.country')`, so a mutation inside `address` reads the address's own `country`, in every form that uses `address`. A rule across two parts of a form goes on the node that holds both, usually the root.
- **The context** is the SDK instance's, with any given to `validate` merged over it, and a `FeaturevisorScope`'s in React: `s.validate("signUp", input, { plan: "paid" })`. A flag that buckets by `userId` needs it there, as it does for `isEnabled`.

### Comparing two fields

`input(...)` after the operator reads the other side of a comparison from another field. Goods shipped to another country than the one billed need a customs description:

```yml
mutations:
  production:
    - key: shipsAbroad
      conditions: input('shippingAddress.country') != input('billingAddress.country')
      mutate:
        required:appendUnique: customsDescription
```

As a tree, the other field goes in `valueFrom`, in place of `value`:

```yml
conditions:
  input: shippingAddress.country
  operator: notEquals
  valueFrom:
    input: billingAddress.country
```

- `value` is always a value, and `valueFrom` always names a field, by a path relative to the same node as `input`. A condition takes one of the two, never both. In an expression, `input(...)` after the operator needs `input(...)` before it, and never goes inside a list: `input('primaryTag') in input('tags')` compares with a list field as a whole.
- Versions read from two fields compare in a tree only, such as `operator: semverGreaterThan` with `valueFrom`, since `semver('...')` takes a written version.
- `matches` and `notMatches` never take their pattern from `valueFrom`, or from `input(...)` in an expression, since a pattern from a user is one nobody reviewed.
- A rule that two fields must agree, such as a password typed twice, changes no rule, so it is not a mutation. It goes in [`issues`](#rules-between-fields).

### Nested mutations

A mutation can hold `mutations` of its own, checked only once it matches and applied after its change, as a global variable's overrides nest. A rule for some of the cases a mutation covers then reads under it:

```yml
mutations:
  production:
    - key: business
      conditions: input('accountType') == 'business'
      mutate:
        required:appendUnique: taxId
      mutations:
        - key: germanBusiness
          conditions: input('country') == 'DE'
          mutate:
            properties.taxId.pattern: "^DE[0-9]{9}$"
            properties.taxId.messages:
              pattern: Enter a German VAT number, such as DE123456789

    - key: paying
      conditions: payingAccounts
      mutations:
        - key: longerBusinessNames
          conditions: input('accountType') == 'business'
          mutate:
            properties.displayName.maxLength: 120
```

- **A child applies only when its parent does**, after the parent's change, so it can change what its parent adds. Every business gives a tax ID, and a German one gives it in the German shape.
- **A parent can only group.** `paying` has no `mutate`, so it changes nothing itself, and its children share its conditions without repeating them.
- **Keys are unique across the whole tree,** since an issue names the mutation that set its rule by its key, such as `mutation: germanBusiness`.
- **Datafiles carry them flat,** each child after its parent with the conditions of both, so applications validate them as any other mutations.
- Mutations nest at any node, and at the root in each environment's list.

### In datafiles

Datafiles carry mutations compiled: `conditions` as features have them, and `mutate` as the operations the SDK applies, so applications parse no notation. The segments, flags and global variables a delivered schema's conditions read come along into the datafile, with everything they read, as a feature's dependencies do, so no target has to select them.

### At runtime

Each node with mutations is validated against its rules with every matching mutation applied, in order. Each combination that matches compiles once and is kept, so a form validated on every keystroke pays for its conditions, not for compiling. Nodes without mutations validate as before, with nothing added. A condition that cannot be answered, such as a reader that fails, reports an `evaluation_error` diagnostic and does not match.

### What reads the base

A handle's `constraints`, `options`, `kind`, `annotations` and `fields` describe a schema's base rules, which no condition changes. Validation, `parse`, `formAction` and every Standard Schema library apply the mutations. A field's handle, such as `at("address")`, applies the mutations inside the field, since it cannot see the fields around it.

### For the values typed so far

`for(values)` gives the same handle for a form's values, whose members describe the rules that apply to them, so a required tax ID shows as required once a business account is chosen, before anything is submitted:

```tsx
export function SignUpForm() {
  const signUp = useSchema("signUp");
  const form = useForm({ resolver: standardSchemaResolver(signUp) });
  const rules = signUp.for(form.watch());

  return (
    <form noValidate onSubmit={form.handleSubmit(createAccount)}>
      <select {...form.register("accountType", { deps: ["taxId"] })}>
        <option value="personal">Personal</option>
        <option value="business">Business</option>
      </select>

      {rules.constraints.taxId.required && (
        <input {...form.register("taxId")} {...rules.at("taxId").constraints} />
      )}
    </form>
  );
}
```

- **Every member, at every depth.** `constraints`, `options`, `kind`, `annotations`, `fields` and `at` apply each mutation whose conditions match, at each node, for that node's own part of the values. A billing and a shipping address each get their own country's rules, each row of an array its own, and an `order` a mutation sets reorders `fields`.
- **A field validates as it would inside the values**, with the value given in its place, so `signUp.for(values).at("taxId").validate("NL1")` reports the pattern a business account must match. The form's resolver keeps the handle itself, which reads the whole value it validates.
- **Context.** A view reads the instance's context, a `FeaturevisorScope`'s in React, and the one given to it, `for(values, { context: { plan } })`, which suits a server rendering a form for a request. A context given to `validate` is merged over it.
- **Short lived.** A view keeps what it works out until the datafile changes, so make one where you render, `signUp.for(form.watch())`, rather than keeping one.
- **What to watch.** `reads` lists the fields the conditions of a handle's mutations and issues read, `["accountType"]` above, so a form can render again or validate again only when one changes: `useWatch({ control: form.control, name: signUp.reads })` in React Hook Form, or `deps` on `register`.

### Types

Generated types come from the base with whatever a mutation widens, since any mutation can match when a value is validated: a value a mutation adds to an `enum` joins the union, a field a mutation adds is an optional key, a field a mutation stops requiring is optional, and a field a mutation requires stays optional.

### Lint

Lint checks every mutation:

- its `key` is unique within its node, nested mutations included, and it has a `mutate`, or `mutations` nested under it,
- its `conditions` are valid conditions, each with `value` or `valueFrom` and never both, each `input` path, in `input` and in `valueFrom`, names a field of its node, and each operator and value suit the field compared, as they must an attribute, so `input('age') startsWith 'x'` on an integer fails,
- every path in its `mutate` reaches into the node,
- the node's rules stay a valid schema with each mutation applied alone and with all of them together,
- no mutation changes a `type`, so a field's type, form data reading and generated types are the same whatever matches.

`input` reads only the value a schema validates, so it goes only in a schema's mutations and [issues](#rules-between-fields): in a feature, a segment or a global variable it is an error, since the context already carries what those know. `allowedConditions` takes a `schemas` location, and `input` as a kind that only that location takes, so a project can keep schema mutations to segments and input, say:

```js
// featurevisor.config.js
module.exports = {
  allowedConditions: {
    schemas: ["segment", "input"],
  },
};
```

Variables cannot use a schema with mutations, since a variable's schema stays the same everywhere and for everyone.

### By environment

Each environment lists its own root mutations, so a mutation can start in dev and reach production a pull request later, and staging lists production's too, or inherits them with `inheritEnvironments: { staging: { from: "production" } }` (see [Rules per environment](#rules-per-environment)). A field's own mutations are a list, the same in every environment.

## Rules between fields

A rule that two fields must agree, such as a password typed twice, changes no rule, so it is not a mutation. An object node carries `issues` for those. Each entry has a `key`, `conditions`, the `path` of the field its issue belongs to, and a `message`, and reports its issue when its conditions match:

```yml
# schemas/signUp.yml
description: A sign up form

type: object

properties:
  password:
    type: string
    minLength: 8
  confirmPassword:
    type: string
    annotations:
      title: Confirmation

required: [password, confirmPassword]

issues:
  - key: passwordsDiffer
    conditions: input('confirmPassword') != input('password')
    path: confirmPassword
    message: "{title} does not match the password"
```

### Conditions say when a value fails

Everywhere in Featurevisor, conditions say when something applies, and here what applies is an issue. An entry whose conditions do not match reports nothing.

### For some users only

Conditions take every kind of leaf, so an entry meant for some users joins their condition and its check with `and`:

```yml
issues:
  - key: dutchShippingCountry
    conditions: country == 'nl' and input('shippingCountry') != input('billingCountry')
    path: shippingCountry
    message: We ship Dutch orders to the billing country only
```

A user outside the Netherlands never gets this issue, whatever the countries, and neither does a context without a `country`. A segment, `netherlands and ...`, or a flag, `feature('strictCheckout') and ...`, works the same, so a stricter check can roll out by percentage.

### Nested issues

Checks for the same users can nest under one entry that holds their condition, with no message of its own:

```yml
issues:
  - key: dutchOrders
    conditions: country == 'nl'
    issues:
      - key: shipsElsewhere
        conditions: input('shippingCountry') != input('billingCountry')
        path: shippingCountry
        message: We ship Dutch orders to the billing country only

      - key: noPhone
        conditions: input('phone') notExists
        path: phone
        message: Dutch couriers need a phone number
```

An entry nested under another reports only when both match, so neither needs `and`. An entry without a `message` only groups, so `dutchOrders` reports nothing itself. Keys are unique across the whole tree, as each is its issue's `params.refine`, and datafiles carry the entries flat, each with the conditions of the entries around it.

### Common checks

| Issue                                   | Conditions                                              |
| --------------------------------------- | ------------------------------------------------------- |
| The passwords differ                    | `input('confirmPassword') != input('password')`         |
| An email typed twice differs            | `input('confirmEmail') != input('email')`               |
| A booking ends when or before it starts | `not (input('end') after input('start'))`               |
| More guests than the room fits          | `input('guests') > input('room.capacity')`              |
| A minimum above its maximum             | `input('minimumPrice') > input('maximumPrice')`         |
| A primary tag outside the chosen tags   | `input('primaryTag') notIn input('tags')`               |
| No way to reach the user                | `input('email') notExists and input('phone') notExists` |
| A password holding the user's name      | `input('password') contains input('displayName')`       |

### How entries run

- **Write the failure.** `!=` for `==`, `>` for `<=`, and `not (...)` for a rule without an opposite. A comparison with a missing input does not match, apart from `notEquals`, so an optional field left empty raises nothing, and `required` covers presence.
- **When entries run.** After the node's own rules, its mutations applied, and only when nothing inside the node has an issue of shape: a missing required field, a value of the wrong type, one outside its `enum` or `const`, a key it does not allow, a `oneOf` no branch fits, or a missing schema. Their values could not be trusted. Other issues hold nothing back, so a password that is too short and a confirmation that differs report both.
- **The issue** has `code: "refine"`, the entry's `path`, relative to the node, and `params: { refine: "passwordsDiffer" }`, with the field's `title`, as a check in code's has, never the values compared. Without a `path`, it belongs to the object, and `flattenIssues` puts it among `formErrors`.
- **Messages.** The entry's `message` is a template, and the field's own. The schema's `messages`, from an enclosing object or beside the field's rules, and a form's, can replace it, with `confirmPassword: { refine: "..." }`. The application's `messages` on `createSchemas` cannot, since the entry's message is the schema's.
- **Reusable schemas** carry their issues into every form that references them, and a field's handle, such as `at("address")`, runs the issues inside the field. Issues on the form's root read fields across the form, so they run when the form is validated.
- **Mutations** change `issues` as they change any rule, so a mutation in dev's list can add one with `issues:append`, and a new issue starts in dev.
- **Lint** checks each entry: a key unique within its node, nested entries included, valid conditions, each `input` path and the entry's `path` naming fields of the node, and a `message` or `issues` nested under it. An entry with a message reads at least one `input`, in its own conditions or those of the entries around it. `issues` goes on object nodes only. Variables cannot use a schema with issues, as for mutations.

Checks that need your application, such as whether a username is free, stay [in code](#checks-in-code), whose `check` says what passes where an entry says what fails.

## Testing schemas

Schemas have specs, as features and segments do, in your tests directory. Each assertion validates a `value` with this package, against the schema as an `environment` builds it, under a `context` its conditions read:

```yml
# tests/schemas/signUp.spec.yml
schema: signUp

assertions:
  - description: A complete sign up
    environment: production
    value:
      accountType: personal
      displayName: Ada
    expectedToBeValid: true

  - description: A business without a tax ID
    environment: production
    value:
      accountType: business
      displayName: Ada
    expectedIssues:
      - path: [taxId]
        code: required
        mutation: business

  - description: Dutch orders ship to the billing country
    environment: production
    context:
      country: nl
    value:
      accountType: personal
      displayName: Ada
      shippingCountry: DE
      billingCountry: NL
    expectedIssues:
      - path: [shippingCountry]
        params:
          refine: dutchShippingCountry
```

- **`expectedToBeValid`** says whether the value passes, and **`expectedIssues`** lists every issue it has, in any order. Each expected issue matches by the fields it gives: `path`, `code`, `mutation`, `message` and `params`, so a spec checks what matters to it and still fails when an issue nobody expected appears.
- **`environment`** is required in a project with environments, since each builds its own version of a schema. **`target`** validates against that target's datafile, so a spec fails when the target does not deliver the schema.
- **Running them:** `featurevisor test` runs schema specs with the rest, and `--entity-type=schema` runs them alone. A failed assertion prints the issues found and a `--case` to rerun it. Lint checks that each spec names a schema, an environment and an expectation.
- **`matrix`** repeats an assertion for each combination, filling any field, `value` and `expectedIssues` included, as feature specs do.
- Specs run in JavaScript, with this package. Runners for other languages skip them until those languages have a validator.
- **In the Catalog**, a schema's page lists its specs on a Tests tab, and its mutations, by environment, and its issues on a Rules tab.

## Reading form data

A form submitted to a server action or a route handler arrives as `FormData`, and search parameters as `URLSearchParams`. Their values are text, and validation never coerces, so read them by the schema's types first:

```ts
const value = signUp.fromFormData(formData);
const result = signUp.validate(value);
```

| Form data                                                       | Value                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Names such as `address.city`, `items.0.name` or `items[0].name` | Nested objects and arrays                                        |
| A name given several times, or written `tags[]`                 | An array, for an array field                                     |
| An empty string                                                 | Absent, so `required` reports it, or `null` for a nullable field |
| A row of objects with every input empty                         | `{}`, so the rows after it keep their indices                    |
| A field typed `integer` or `number`                             | The number its trimmed text spells, or the text itself           |
| A field typed `boolean`                                         | `true` for `on` or `true`, and `false` for `false` or absent     |
| A required array field with nothing chosen                      | `[]`, as a multiple select sends nothing                         |
| A name the schema does not describe                             | Left out                                                         |
| A file                                                          | Left as it is                                                    |

Names the schema does not describe are left out, so a submit button's name or a CSRF token never fails a closed object. A row of objects keeps its index even when every input in it is empty, so an issue such as `items.1.quantity` sits beside the input it is about, and a blank row left for adding an item reports its required fields. A list of plain values, such as `tags[1]`, closes its gaps instead, since an empty value cannot hold a place. A field typed only by its listed values, such as `enum: [1, 2]`, is read as a number or a boolean too.

## Server actions

`formAction` turns a handle into a server action, or a router action. It reads the form data by the schema's types, validates it, and answers with the issues by field, or runs your function with the value and answers with what it returns:

```ts
"use server";

import { headers } from "next/headers";
import { formAction, type FormActionState } from "@featurevisor/schemas";
import { s } from "../featurevisor";

const signUp = formAction(
  s.get("signUp"),
  async (value) => {
    const account = await createAccount(value);

    return { accountId: account.id };
  },
  {
    context: async () => ({ locale: (await headers()).get("accept-language") ?? "en" }),
    omit: ["password"],
  },
);

export async function signUpAction(previous: FormActionState, formData: FormData) {
  return signUp(previous, formData);
}
```

```tsx
"use client";

import { useActionState } from "react";
import { initialFormState } from "@featurevisor/schemas";

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, initialFormState);

  return (
    <form action={action}>
      <input name="email" defaultValue={String(state.values?.email ?? "")} />
      {state.errors.fieldErrors.email?.[0]}

      <button>Sign up</button>
    </form>
  );
}
```

- A failed submit answers `{ ok: false, errors, values }`. `errors` has `formErrors` and `fieldErrors`, as `flattenIssues` gives them, and `values` holds what was read, without files, so a form that works before its JavaScript loads can show what was typed again.
- A passing submit answers `{ ok: true, errors }`, with what your function returns merged in. Your function gets the value, which has passed every rule and check, and `{ formData, previousState }`.
- `context` is merged over the instance's for this submit, as an object or a function of the form data that can return a promise. One SDK instance serves every request on a server, so this is how messages follow the request's language and checks see its user.
- `omit` lists fields a failed submit never sends back in `values`, such as a password, by field path as `at` takes them, so `items[].secret` leaves it out of every row.
- `initialFormState` is the state before the first submit, frozen, since every form shares it.
- A React Router action calls it with `await request.formData()`.

## React

`@featurevisor/schemas/react` has an optional provider and three hooks. Under a `FeaturevisorProvider`, they need nothing more:

```tsx
import { useSchema } from "@featurevisor/schemas/react";

export function SignUpForm() {
  const signUp = useSchema("signUp");

  return (
    <form>
      <input name="displayName" {...signUp.constraints.displayName} />

      <select name="country" {...signUp.constraints.country}>
        {(signUp.options.country ?? []).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.title ?? String(option.value)}
          </option>
        ))}
      </select>

      <button>Sign up</button>
    </form>
  );
}
```

### `useSchema`

`useSchema(key, options)` returns the handle, and renders the component again when a new datafile changes the schema, its annotations and choices included. Context and flag changes never render it again. Options can be written inline: the hook keeps one handle per key for the component and reads the latest options when it validates. Inside a `FeaturevisorScope`, it validates and parses with the scope's context, as flag hooks do, and a context given to `validate` or `parse` is merged over it. Its `at` and `fields` give handles that do the same. With checks in code, it also:

- keeps each check's answer for the component's life, per value, per the values its `reads` name and per context, so leaving a field and then submitting asks once, and asks again after a check failed to run,
- shares one call between validations waiting on the same value, and
- lets the latest validation win: a newer one aborts the older one's checks, and the older one settles with the newer one's result.

### `useValidation`

`useValidation(keyOrHandle, value, { debounce })` validates a value while rendering, for a field checked as the user types, with the context of any `FeaturevisorScope` around it. Rules answer at once. Checks in code wait for `debounce` milliseconds, and the result's `validating` is true while they run, and run again when the value, the datafile or the scope's context changes:

```tsx
export function UsernameField({ value, onChange }) {
  const signUp = useSchema("signUp", { refine: [usernameAvailable] });
  const username = useValidation(signUp.at("username"), value, { debounce: 400 });

  return (
    <label>
      Username
      <input value={value} onChange={(event) => onChange(event.target.value)} />
      {username.validating && <small>Checking…</small>}
      {username.issues && <small>{username.issues[0].message}</small>}
    </label>
  );
}
```

### `useSchemas` and `SchemasProvider`

`useSchemas()` returns the instance, for event handlers and other code outside rendering.

`SchemasProvider` is for an application with something to configure: `messages` and `message` for the instance it creates, or `schemas` for an instance created elsewhere, which needs no `FeaturevisorProvider`. The latest `messages` and `message` are used, so a language switch takes effect at the next validation.

### Form libraries

Every form library that takes a Standard Schema takes a handle:

```tsx
// React Hook Form, with @hookform/resolvers
const form = useForm({ resolver: standardSchemaResolver(signUp) });

// TanStack Form
const form = useForm({ defaultValues, validators: { onChange: signUp } });
```

With a form library, put `noValidate` on the form so its messages show instead of the browser's.

There are no hooks for annotations, choices or fields, since each would save one property access: read them from the handle `useSchema` returns. Server code has no hooks either. It uses an instance created beside the server's SDK instance, and `formAction` makes server actions from its handles (see [Server actions](#server-actions)).

## Rendering forms

These recipes use the code `featurevisor generate-code --schemas --react` writes (see [Code generation](#code-generation)), so annotations and choices are typed by your vocabularies. Every one also works with the package's own hooks, which type annotations as `unknown`.

### A field by hand

A form written by hand reads each field's annotations through `at`:

```tsx
import { useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useSchema } from "./featurevisor";

export function SignUpForm() {
  const signUp = useSchema("signUp");
  const form = useForm({ resolver: standardSchemaResolver(signUp) });

  const email = signUp.at("email");
  const { title, placeholder, input, autocomplete, help } = email.annotations;
  const { error } = form.getFieldState("email", form.formState);

  return (
    <form noValidate onSubmit={form.handleSubmit(createAccount)}>
      <h1>{signUp.annotations.title}</h1>

      <label>
        {title}
        <input
          {...form.register("email")}
          {...email.constraints}
          type={input ?? "text"}
          placeholder={placeholder}
          autoComplete={autocomplete}
        />
      </label>
      {help && <small>{help}</small>}
      {error && <p role="alert">{error.message}</p>}

      <button>{signUp.annotations.submitLabel ?? "Continue"}</button>
    </form>
  );
}
```

### A generic renderer

One component renders any schema in your vocabulary, following `order`, your own `hidden` and `input` annotations, and the kind a field's rules imply. It renders from a view for the values typed so far, so the fields follow the mutations that match them:

```tsx
export function SchemaForm({ schemaKey, onSubmit }) {
  const schema = useSchema(schemaKey);
  const form = useForm({ resolver: standardSchemaResolver(schema) });
  const rules = schema.for(form.watch());

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <h1>{rules.annotations.title}</h1>

      {rules.fields
        .filter((field) => !field.annotations.hidden)
        .map((field) => (
          <SchemaField key={field.path} field={field} form={form} />
        ))}

      <button>{schema.annotations.submitLabel ?? "Continue"}</button>
    </form>
  );
}

function SchemaField({ field, form }) {
  const { title, help, placeholder, input } = field.annotations;
  const { error } = form.getFieldState(field.path, form.formState);

  // An object field, such as an address, renders its own fields in its own order.
  if (field.fields.length > 0) {
    return (
      <fieldset>
        <legend>{title}</legend>
        {field.fields
          .filter((child) => !child.annotations.hidden)
          .map((child) => (
            <SchemaField key={child.path} field={child} form={form} />
          ))}
      </fieldset>
    );
  }

  // The project's own input annotation wins over the kind the rules imply.
  const kind = input ?? field.kind;
  const control =
    kind === "select" ? (
      <select {...form.register(field.path)} {...field.constraints}>
        {field.options
          .filter((option) => !option.hidden)
          .map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.title ?? String(option.value)}
            </option>
          ))}
      </select>
    ) : kind === "boolean" || kind === "checkbox" ? (
      <input type="checkbox" {...form.register(field.path)} {...field.constraints} />
    ) : (
      <input
        {...form.register(field.path, { valueAsNumber: kind === "number" })}
        {...field.constraints}
        type={kind === "number" ? "number" : (input ?? "text")}
        placeholder={placeholder}
      />
    );

  return (
    <label>
      {title ?? field.name}
      {control}
      {help && <small>{help}</small>}
      {error && <p role="alert">{error.message}</p>}
    </label>
  );
}
```

A new field, a new title, a reordered form or a retired choice then ships from your Featurevisor project, with no change to the component. With the [address](#a-postcode-per-country) from the recipes, choosing a US address marks its state required, also with no line in the component. A select's values are text in the DOM, so a field whose choices are numbers reads them back with `setValueAs`, and a `multiselect` renders checkboxes or a `<select multiple>` from the same `options`.

### Rows of an array

Rows are data, so your form library keeps them, and each row's handle comes from `at(index)`:

```tsx
import { useFieldArray } from "react-hook-form";

function ItemsField({ form }) {
  const items = useSchema("order").at("items");
  const rows = useFieldArray({ control: form.control, name: "items" });

  return (
    <fieldset>
      <legend>{items.annotations.title}</legend>
      {rows.fields.map((row, index) => (
        <div key={row.id}>
          {items.at(`${index}`).fields.map((field) => (
            <SchemaField key={field.path} field={field} form={form} />
          ))}
          <button type="button" onClick={() => rows.remove(index)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => rows.append({})}>
        Add an item
      </button>
    </fieldset>
  );
}
```

Each row's fields have paths such as `items.0.name`, the names React Hook Form registers, and issues sit at the same paths.

### Reference data

Since `country` is a schema of its own, one select serves every form that references it, and one badge shows any plan saved earlier:

```tsx
export function CountrySelect(props) {
  const country = useSchema("country");

  return (
    <select {...props} {...country.constraints}>
      {country.options
        .filter((option) => !option.hidden)
        .map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.title ?? String(option.value)}
          </option>
        ))}
    </select>
  );
}

export function PlanBadge({ plan }) {
  const option = useSchema("plan").option(plan);

  return <Badge tone={option?.tone}>{option?.title ?? plan}</Badge>;
}
```

### Without React

A web component, a page rendered on a server, or a native app reads the same handle. The DOM's own `Option` fills a select, and `subscribe` keeps it current:

```js
const country = s.get("signUp").at("country");
const select = document.querySelector("select[name=country]");

function render() {
  select.required = Boolean(country.constraints.required);
  select.replaceChildren(
    ...country.options
      .filter((option) => !option.hidden)
      .map((option) => new Option(option.title ?? String(option.value), String(option.value))),
  );
}

render();
const stop = country.subscribe(render);
```

### Without JavaScript

A form that posts to a [server action](#server-actions) works before its JavaScript loads. Render it from the server's handle, with `defaultValue` from `state.values`, and its issues from `state.errors.fieldErrors`, keyed by the same paths as `fields` gives.

## Code generation

`featurevisor generate-code` writes a type per schema in `schemas.ts`, a `SchemaTypes` interface from key to type for the schemas the selected targets deliver, and a `SchemaVocabularies` interface with what each one's `annotationsSchema` and `optionSchema` declare. With `--schemas`, it adds a typed `createSchemas`, and with `--react` as well, typed hooks in `schemas-react.ts`:

```bash
npx featurevisor generate-code --language typescript --out-dir src/featurevisor --target web --schemas --react
```

```ts
import { createSchemas } from "./featurevisor";

const s = createSchemas(f);

const signUp = s.get("signUp"); // a handle for SignUpSchema

s.get("singUp"); // a type error

if (signUp.isValid(input)) {
  input.displayName; // string
}

signUp.at("address.city"); // a handle for string
signUp.at("items[].quantity"); // a handle for number
signUp.at("displayNam"); // a type error

signUp.at("email").annotations.placeholder; // string | undefined
signUp.at("email").annotations.placeholdr; // a type error
signUp.at("country").option("GB")?.flag; // string | undefined
signUp.at("country").option("FR"); // a type error
```

Field paths are typed like React Hook Form's field names, in every form `at` takes, and a field's handle is typed by the field. A nullable field or a `oneOf` is a field of its own, since `at` stops there. So are the paths and `reads` of checks in code, and the value a check gets is typed by its path:

```ts
s.get("signUp", {
  refine: [
    {
      key: "usernameAvailable",
      path: "username",
      check: async (username) => isFree(username), // username is a string
    },
  ],
});
```

Annotations are typed by the vocabulary with the built in annotations added, and choices as `{ value, title }` with the option vocabulary's fields, so `option.flg` is a type error and a `switch` over `option.value` is exhaustive. A schema without a vocabulary has the built in annotations only. Every annotation and every field of a choice stays optional in types, even one a vocabulary lists in `required`, since a target with `includeAnnotations: false` delivers none, and a single `const` or a nullable field's `null` carries no entry, so code writes `??` where lint has done the guaranteeing. Every field of a handle is typed with the vocabularies of the schema you got it from, including fields inside a schema it references, whose own vocabulary may differ. `fields` types each field's value as `unknown`, as any generic renderer does.

Without generated code, `createSchemas<SchemaTypes, SchemaVocabularies>(f)` and `useSchema<SignUp, boolean, SignUpVocabularies>("signUp")` take types by hand. `FieldPath<T>` and `FieldValue<T, P>` name a type's paths and the value at one, `InferSchema<typeof signUp>` the type a handle validates, and `SchemaKey<typeof s>` the keys an instance knows, so a type is never written twice. With types, `options` and `option` take only the values a field allows, and `s.has(key)` narrows a string to a known key.

## Recipes

Real cases, each a schema with its conditions written as expressions. Each passes lint, and a [spec](#testing-schemas) proves it, as the first one shows. Each lists production's mutations, in a project whose staging inherits them with `inheritEnvironments: { staging: { from: "production" } }`.

### A postcode per country

An address checks its postcode by its own country, and a US address needs a state:

```yml
# schemas/address.yml
description: A postal address

type: object

properties:
  street:
    type: string
  postcode:
    type: string
  city:
    type: string
  state:
    type: string
  country:
    type: string
    enum: [NL, GB, US]

required: [street, postcode, city, country]

mutations:
  production:
    - key: netherlands
      conditions: input('country') == 'NL'
      mutate:
        properties.postcode.pattern: "^[1-9][0-9]{3} ?[A-Z]{2}$"
        properties.postcode.messages:
          pattern: Enter a postcode such as 1011 AB

    - key: unitedStates
      conditions: input('country') == 'US'
      mutate:
        required:appendUnique: state
        properties.postcode.pattern: "^[0-9]{5}$"
        properties.postcode.messages:
          pattern: Enter a 5 digit ZIP code
```

Every form that references it gets the same rules, and each address reads its own country, so a Dutch billing address and a US shipping address in one checkout each get theirs:

```yml
# schemas/checkout.yml
description: Checkout

tags:
  - web

type: object

properties:
  billingAddress:
    schema: address
  shippingAddress:
    schema: address

required: [billingAddress]
```

```yml
# tests/schemas/checkout.spec.yml
schema: checkout

assertions:
  - description: A US address needs a state and a ZIP code
    environment: production
    value:
      billingAddress:
        street: 1 Main St
        postcode: 1012 LG
        city: Springfield
        country: US
    expectedIssues:
      - path: [billingAddress, state]
        code: required
        mutation: unitedStates
      - path: [billingAddress, postcode]
        code: pattern
        message: Enter a 5 digit ZIP code
```

### Limits by plan

A free plan holds up to 5 seats and a business plan 50, and the message changes with the limit, so a free account sees why it stopped:

```yml
# schemas/team.yml
description: A team's settings

tags:
  - web

type: object

properties:
  name:
    type: string
  seats:
    type: integer
    minimum: 1
    maximum: 5
    messages:
      maximum: The free plan holds up to {maximum} seats. Upgrade for more

required: [name, seats]

mutations:
  production:
    - key: businessPlan
      conditions: plan == 'business'
      mutate:
        properties.seats.maximum: 50
        properties.seats.messages.maximum: Business plans hold up to {maximum} seats
```

The plan comes from the context, the SDK instance's or one given to the call: `s.validate("team", value, { plan: account.plan })`. A segment reads the same, `conditions: businessAccounts`, and so does a spec, with `context: { plan: business }`.

### A field another field makes required

Texting a customer needs a phone number, and emailing one an email address:

```yml
# schemas/contact.yml
description: How we reach a customer

type: object

properties:
  contactBy:
    type: string
    enum: [email, phone, text]
  email:
    type: string
  phone:
    type: string

required: [contactBy]

mutations:
  production:
    - key: byPhone
      conditions: input('contactBy') in ['phone', 'text']
      mutate:
        required:appendUnique: phone

    - key: byEmail
      conditions: input('contactBy') == 'email'
      mutate:
        required:appendUnique: email
```

`in` takes a list, so one mutation serves both ways of reaching a phone. The `required` issue names the mutation, `mutation: byPhone`, and in a form `contact.for(values).at("phone").constraints.required` turns true as soon as texts are chosen, so the field can say it is needed before the form is sent. A business account's tax ID is the same recipe (see [Rules under conditions](#rules-under-conditions)).

### A booking form

A room's size limits the guests, and the stay must end after it starts:

```yml
# schemas/booking.yml
description: A hotel booking

tags:
  - web

type: object

properties:
  checkIn:
    type: string
    format: date-time
  checkOut:
    type: string
    format: date-time
  room:
    type: string
    enum: [single, double, family]
  guests:
    type: integer
    minimum: 1
    maximum: 6

required: [checkIn, checkOut, room, guests]

mutations:
  production:
    - key: singleRoom
      conditions: input('room') == 'single'
      mutate:
        properties.guests.maximum: 1

    - key: doubleRoom
      conditions: input('room') == 'double'
      mutate:
        properties.guests.maximum: 2

issues:
  - key: checkOutNotAfterCheckIn
    conditions: not (input('checkOut') after input('checkIn'))
    path: checkOut
    message: Check out must come after check in
```

A room's size changes a rule, the most guests, so it is a mutation, and three guests in a double room report `maximum` with `mutation: doubleRoom`. Dates in order change no rule, so they go in `issues`, which say when a value fails. `after` compares the two timestamps. A missing date holds the entry back, as every issue of shape does, while a date that is not a timestamp reports `format` and the entry both, since `format` holds nothing back.

### Roll out a stricter rule

Longer passwords reach a quarter of users first, through a flag, and everyone once its rule says 100:

```yml
# features/strictPasswords.yml
description: Passwords of 12 characters or more, rolling out

bucketBy: userId

rules:
  staging:
    - key: everyone
      conditions: "*"
      percentage: 100

  production:
    - key: quarter
      conditions: "*"
      percentage: 25
```

```yml
# schemas/signUp.yml
mutations:
  production:
    - key: strictPasswords
      conditions: feature('strictPasswords')
      mutate:
        properties.password.minLength: 12
```

The flag comes along into every datafile that delivers the schema, with no tag of its own. Validation buckets as flags do, so the context needs what the flag buckets by, `s.validate("signUp", value, { userId })`. Staging inherits the mutation and has the flag at 100%, so a spec proves the rule there:

```yml
# tests/schemas/signUp.spec.yml
schema: signUp

assertions:
  - description: Everyone in staging needs 12 characters
    environment: staging
    context:
      userId: user-1
    value:
      email: user-1@example.com
      password: correcthors
    expectedIssues:
      - path: [password]
        code: minLength
        mutation: strictPasswords
```

### A kill switch

Sign ups that verify a phone by text message stop working when texts cannot be sent. One global variable makes the phone optional, in every schema that reads it, without reverting a rule:

```yml
# variables/phoneOptional.yml
description: Lets sign ups skip the phone number while text messages cannot be sent

type: boolean

defaultValue: false
```

```yml
# schemas/signUp.yml
required: [email, password, phone]

mutations:
  production:
    - key: phoneOptional
      conditions: variable('phoneOptional') == true
      mutate:
        required:removeValue: phone
```

During an incident, a pull request turns it on in production, and every app has it at its next datafile:

```yml
# variables/phoneOptional.yml
overrides:
  production:
    - key: incident
      conditions: "*"
      value: true
```

Removing the override ends it. The variable comes along into the datafile with the schema, as the flag above does.

### Try a rule in staging first

A change reaches one environment, then the next, then the base:

```yml
# schemas/displayName.yml
description: A display name

type: string

minLength: 2

maxLength: 40

mutations:
  staging:
    - key: longerNames
      conditions: "*"
      mutate:
        maxLength: 60

  production: []
```

Staging accepts names up to 60 characters while production keeps 40, and since the mutation always applies, staging's datafile holds `maxLength: 60` as the rule itself. Once staging has proved it, write 60 into the base and remove the mutation (see [Rules per environment](#rules-per-environment)). A flag rolls a rule out to users, and an environment's list to environments, and a schema can use both.

### The same rules on the server

A handle is a Standard Schema, so a server's router validates with it as it would with Zod. Give it to the router once, at start up, since a handle reads the current datafile whenever it validates:

```ts
// tRPC
export const appRouter = t.router({
  signUp: t.procedure.input(s.get("signUp")).mutation(({ input }) => createAccount(input)),
});
```

```ts
// Hono, with @hono/standard-validator
import { sValidator } from "@hono/standard-validator";

app.post("/sign-up", sValidator("json", s.get("signUp")), async (c) => {
  const signUp = c.req.valid("json");

  return c.json(await createAccount(signUp));
});
```

A rule changed in the project reaches the browser and the server at their next datafile, so the two never disagree. A schema whose conditions read who is asking, such as a plan, validates in the handler instead, with that context: `s.parse("team", body, { plan: account.plan })`. Without a router, `s.parse` throws a `SchemaError` for one error handler to answer (see [Validating](#validating)), and a form posted without JavaScript goes through [`formAction`](#server-actions).

### Choices that change without a deploy

Countries with flags, plans with prices and badges, and retired choices kept for data saved earlier live in the schema, and every select and badge reads them (see [Choices](#choices) and [Reference data](#reference-data)). Adding a country is a pull request that adds a value to the `enum` and its entry to `options`.

## API reference

### `@featurevisor/schemas`

| Export                                 | What it is                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `createSchemas(f, options?)`           | The instance for an SDK instance, `s`. `options` take `messages` and `message`      |
| `flattenIssues(issues)`                | Issues grouped by field, as `{ formErrors, fieldErrors }`                           |
| `SchemaError`                          | What `parse` throws, with `schema`, `issues` and `flattened`                        |
| `formAction(handle, action, options?)` | A server action or router action from a handle. `options` take `context` and `omit` |
| `initialFormState`                     | A form action's state before the first submit                                       |

The instance, `s`:

| Member                           | What it is                                                    |
| -------------------------------- | ------------------------------------------------------------- |
| `get(key, options?)`             | A schema's handle. `options` take `messages` and `refine`     |
| `validate(key, value, context?)` | A Standard Schema result                                      |
| `isValid(key, value, context?)`  | A boolean, and a type guard with types                        |
| `parse(key, value, context?)`    | The value, or a thrown `SchemaError`                          |
| `keys()`                         | The keys of the schemas the datafile has                      |
| `has(key)`                       | Whether the datafile has a schema, narrowing a key with types |
| `close()`                        | Stops every listener the instance and its handles started     |

A handle's members are in [Handles](#handles). Every one of them reads the current datafile when used.

| Type                                                                        | What it is                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Schemas<TSchemas, TVocabularies>`                                          | The instance, typed by schema and by vocabulary                                       |
| `SchemaHandle<T, TAsync, V>`                                                | A handle, synchronous unless a check in code can return a promise                     |
| `SyncSchemaHandle`, `AsyncSchemaHandle`, `SchemaHandleBase`                 | The two kinds of handle, and what both have                                           |
| `SchemasOptions`                                                            | `messages` per issue code and the `message` translator                                |
| `HandleOptions`, `Refinement`, `CheckInfo`                                  | A handle's `messages` and `refine`, one check, and what a check gets                  |
| `ValidateOptions`, `ViewOptions`                                            | `context` and `signal` for `validate`, `isValid` and `parse`, and `context` for `for` |
| `SchemaResult`, `SchemaSuccess`, `SchemaFailure`                            | A validation's result                                                                 |
| `SchemaIssue`, `IssueCode`, `PathKey`                                       | One issue, its code, and a step of its path                                           |
| `Message`, `MessageInfo`, `CodeMessages`, `FieldMessages`                   | A message or its function, what the function gets, and messages by code and by field  |
| `FieldConstraints`, `ConstraintsOf<T>`                                      | HTML attributes, for a field or by field path                                         |
| `SchemaOption<T, V>`, `OptionsOf<T, V>`, `OptionFieldsOf<V>`, `ChoiceOf<T>` | A choice, a handle's choices, what a choice carries, and the value one holds          |
| `AnnotationsOf<V>`, `BuiltInAnnotations`                                    | A handle's annotations, and the four built in ones                                    |
| `Vocabulary`, `VocabularyOf<TVocabularies, K>`                              | What a schema's vocabularies declare, and one schema's                                |
| `FieldKind`                                                                 | What `kind` can be                                                                    |
| `FieldPath<T>`, `FieldValue<T, P>`                                          | The paths `at` takes, and the value at one                                            |
| `InferSchema<THandle>`, `SchemaKey<TSchemas>`, `IsAsync<TResult>`           | A handle's type, an instance's keys, and whether checks make a handle asynchronous    |
| `FlattenedIssues`                                                           | What `flattenIssues` returns                                                          |
| `FormActionState`, `FormActionInfo`, `FormActionOptions`                    | A form action's state, what its function gets, and its options                        |
| `StandardSchemaV1`                                                          | The Standard Schema interface, version 1                                              |

### `@featurevisor/schemas/react`

| Export                                                          | What it is                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `SchemasProvider`                                               | Configures the instance for the hooks below, with `messages`, `message` or `schemas` |
| `useSchemas()`                                                  | The instance                                                                         |
| `useSchema(key, options?)`                                      | A component's handle, which renders again when the schema changes                    |
| `useValidation(keyOrHandle, value, options?)`                   | A value validated while rendering, with `debounce` for checks in code                |
| `SchemasProviderProps`, `ValidationOptions`, `ValidationResult` | Their types                                                                          |

## How values are checked

Validation applies exactly the rules lint applies to variable values, since lint checks values with this package's own engine, so a value valid in one is valid in the other:

- An object with `properties` rejects keys it does not list, unless `additionalProperties` allows them. `additionalProperties: true` allows any other key with any value.
- An object with neither `properties` nor `additionalProperties` holds strings, numbers, booleans and `null` only.
- Every node has a `type`, or describes its value with `schema`, `oneOf`, `const` or `enum`, which lint requires.
- There is no `null` type. A nullable field is a `oneOf` with `const: null` as one branch. When each branch of a `oneOf` takes a different type, the value's type selects a branch, and that branch's own issues are reported, so a nullable name that is too long reports `maxLength`.
- A `oneOf` whose every branch is a `const` is a list of choices, and reports `enum`.
- `minLength` and `maxLength` count characters as JSON Schema does, in code points, so an emoji counts one.
- `pattern` is a regular expression, tested unanchored.
- `format: date-time` takes the portable timestamps conditions compare, and `format: semver` the versions they compare. A `const` or an `enum` with `format: date-time` must still hold timestamps, so a listed value that is not one fails `format`.
- A number that is not finite fails, and a key whose value is `undefined` counts as absent.
- An object is a plain object, as JSON has, from any realm, so one `structuredClone`, a frame or a worker hands over is one, while a `Date`, a `File` or a class instance is not, and an issue names what it got, such as `date`.
- Annotations never change a result.

The rules are portable: `conformance/schemas-validation.json` in the Featurevisor repository holds a case for each, with the issues expected, and this package runs every one.

Compiled schemas are kept until the datafile changes them. Compiling builds functions without `new Function`, so the package works under a strict Content Security Policy.

## Changing a delivered schema

A schema that a target delivers is a contract with every application that loads it, and it changes without those applications being deployed again. Narrowing it, such as a lower `maxLength`, a new required key or a shorter `enum`, only rejects more values. Widening it lets values through that code compiled against its old types may not expect.

`featurevisor diff` warns when a change widens a schema that a target delivers, directly or through a reference, saying how and naming the targets. Regenerate the applications' types and release them before such a change.

Changing annotations or choices' entries widens nothing, since validation never reads them, and reaches applications at their next datafile. A new name in a vocabulary needs regenerated types before code reads it with types.

## Not yet

Later releases of this package are planned to add:

- versions a schema points to per environment, each a whole schema of its own, and a warning when a change reaches an environment before the one before it,
- rendering again in React when a context a schema's conditions read changes,
- choosing between shapes, such as a payment method of card or bank, each an object told apart by a discriminator,
- messages and annotations that depend on conditions, written as a list of variants where the first that matches wins, such as "ZIP code" in the US and "postcode" elsewhere,
- annotations in `featurevisor diff`, and conversion to JSON Schema, with `title` and `examples` as its own keywords.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
