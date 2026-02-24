---
title: Variable mutations
nextjs:
  metadata:
    title: Variable mutations
    description: Mutation variable values when overriding them to avoid full replacements
    openGraph:
      title: Variable mutations
      description: Mutation variable values when overriding them to avoid full replacements
      images:
        - url: /img/og/docs-mutations.png
---

Variable mutations are a way to mutate (change) variable values partially when overriding them from feature's [rules](/docs/features/#rules) or [variations](/docs/features/#variations). {% .lead %}

This is useful when we are dealing with complex [variables](/docs/features/#variables), like deep nested objects or arrays of objects.

Without mutations, we would have to define the full value of the variable each time we want to override only a few properties or items, which is cumbersome and error-prone.

## Defining variables

Before going into the details of variable mutations, it's worth understanding how variables are defined in Featurevisor first.

Their schemas are defined under the `variablesSchema` property inside a [feature](/docs/features/#variables), and each variable must at least provide:

- a `type`, and
- a `defaultValue`

### Simple variables

Variables are always defined with a default value at individual feature level:

```yml {% path="features/myFeature.yml" highlight="4" %}
# ...

variablesSchema:
  bgColor:
    type: string
    defaultValue: red
```

### Complex objects

Some variables may be more complex with a structure of nested objects or arrays of objects:

```yml {% path="features/myFeature.yml" highlight="4" %}
# ...

variablesSchema:
  hero:
    type: object
    properties:
      title:
        type: string
      subtitle:
        type: string
    defaultValue:
      title: Welcome
      subtitle: Welcome to our website
```

### Complex arrays

Some variables may be arrays of objects:

```yml {% path="features/myFeature.yml" highlight="4" %}
# ...

variablesSchema:
  navLinks:
    type: array
    items:
      type: object
      properties:
        title:
          type: string
        url:
          type: string
    defaultValue:
      - title: Home
        url: /
      - title: About
        url: /about
      - title: Contact
        url: /contact
```

When schemas go large, it's recommended to use [reusable schemas](/docs/schemas/) to avoid duplication.

## Overriding variables

Variables can be overridden from multiple places in the feature definition, including:

- [rules](/docs/features/#from-rules)
- [variations](/docs/features/#from-variations)

### Overriding from rules

You can override variable values for specific rules:

```yml {% path="features/myFeature.yml" highlight="8-12" %}
# ...

rules:
  production:
    - key: nl
      segments: netherlands # references segments/netherlands.yml
      percentage: 100
      variables:
        bgColor: orange
        hero:
          title: Welcome
          subtitle: Welcome to our website in the Netherlands

    - key: everyone
      segments: '*'
      percentage: 100
```

Notice how, for the Netherlands rule, we are overriding only 2 out of our 3 variables: `bgColor` and `hero`.

Other rule(s) will gracefully fall back to the default values.

### Overriding from variations

Overriding for a specific variation, with other variation(s) keep getting the default values:

```yml {% path="features/myFeature.yml" highlight="9-13" %}
# ...

variations:
  - value: control
    weight: 50

  - value: treatment
    weight: 50
    variables:
      bgColor: blue
      hero:
        title: Welcome
        subtitle: 'Welcome to our website!!!'
```

## Challenges

For simple variables, it's easy to override their primitive values (like strings, booleans, etc) directly.

But when we are dealing with complex objects or arrays, we are forced to define the full value of the variable even
when we only want to override a few properties or items.

This is where variable mutations come in.

## Mutations

Variable mutations are a way to override only a few properties or items in an object or array.

In above examples, we can notice when overriding the `hero` variable that:

- we are only truly overriding the `subtitle` property, and
- the `title` property remains the same with the value `Welcome`

With mutations syntax, we can override only the `subtitle` property without having to define the full `hero` object:

```yml {% path="features/myFeature.yml" highlight="10" %}
# ...

rules:
  production:
    - key: nl
      segments: netherlands # references segments/netherlands.yml
      percentage: 100
      variables:
        bgColor: orange
        hero.subtitle: "Welcome to our website in the Netherlands"
```

Notice how we are using `hero.subtitle` as a key to override the `subtitle` property of the `hero` object.

The rest of the `hero` object remains the same as its default value.

## Syntax

Mutations go beyond just setting a single property's value. It also supports:

| Syntax                             | Variable type | Description                                                  |
| ---------------------------------- | ------------- | ------------------------------------------------------------ |
| `variableKey.property`             | object        | Set a property (supports nested path, e.g. `a.b.c`)          |
| `variableKey.property:remove`      | object        | Remove a property (not allowed if property is in `required`) |
| `variableKey[index]`               | array         | Set the item at the given index                              |
| `variableKey[index].property`      | array         | Set a property of the item at the given index                |
| `variableKey[index]:before`        | array         | Insert an item before the item at the given index            |
| `variableKey[index]:after`         | array         | Insert an item after the item at the given index             |
| `variableKey[index]:remove`        | array         | Remove the item at the given index                           |
| `variableKey[prop=value].property` | array         | Set a property of the item matching the selector             |
| `variableKey[prop=value]:before`   | array         | Insert an item before the item matching the selector         |
| `variableKey[prop=value]:after`    | array         | Insert an item after the item matching the selector          |
| `variableKey[prop=value]:remove`   | array         | Remove the item matching the selector                        |
| `variableKey:prepend`              | array         | Insert a new item at the beginning of the array              |
| `variableKey:append`               | array         | Insert a new item at the end of the array                    |

## Linting

Because everything is backed by schemas, we can lint everything to figure out if we tried mutating a variable in a wrong way early:

```{% title="Command" %}
$ npx featurevisor lint
```

Learn more in [Linting](/docs/linting) page.

## Further reading

- [Defining variables](/docs/features/#variables)
- [Reusable schemas](/docs/schemas/)
