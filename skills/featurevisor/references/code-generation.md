# Code generation

Full docs: <https://featurevisor.com/docs/code-generation/>

Generate TypeScript bindings from the project, so applications get autocompletion and compile time checks on feature keys, variation values, variable keys and types, and context attributes. TypeScript is the only language today.

```bash
npx featurevisor generate-code --language typescript --out-dir ./src/featurevisor
```

| Option              | Effect                                                      |
| ------------------- | ----------------------------------------------------------- |
| `--tag=<tag>`       | only features and global variables with the tag. Repeatable |
| `--target=<target>` | only what the target selects. Repeatable                    |
| `--react`           | also generate typed React hooks                             |

Several tags and targets form a union. Like datafiles, the output includes the definitions selected ones reference.

## Output

| File            | Contents                                                                           |
| --------------- | ---------------------------------------------------------------------------------- |
| `context.ts`    | the `Context` interface, from attributes                                           |
| `attributes.ts` | one type per attribute                                                             |
| `features.ts`   | `FeatureKey`, `Variation<F>`, `FeatureVariableKey<F>`, `FeatureVariableType<F, V>` |
| `variables.ts`  | `Variables`, `VariableKey`, `VariableType<K>` for global variables                 |
| `functions.ts`  | typed `isEnabled`, `getVariation` and `getVariable`                                |
| `instance.ts`   | `setInstance` and `getInstance`                                                    |
| `index.ts`      | exports everything                                                                 |
| `react.ts`      | typed hooks, with `--react`                                                        |

Types follow the schemas: `enum` and `const` become literal types, `required` properties are non optional, `format: date-time` attributes accept `Date | string`. A composition's type is derived from its sources, read only, and conservatively nullable, because any member can be `null` at runtime.

## Use in an application

```ts
import { createFeaturevisor } from '@featurevisor/sdk'
import { setInstance, isEnabled, getVariation, getVariable } from './featurevisor'

const f = createFeaturevisor({ datafile })
setInstance(f)

const context = {
  userId: '8f2a',
  country: 'nl',
}

isEnabled('checkout', context) // an unknown key is a type error
getVariation('pricing', context) // 'control' | 'treatment' | null
getVariable('buyButton', 'label', context) // string | null
getVariable('supportEmail', context) // a global variable
```

Call `setInstance` before using the functions, or they throw. Imports use `.js` extensions, which works with NodeNext, CommonJS and bundlers.

## When to suggest it

- The application is TypeScript and calls the SDK with string keys.
- Typos in keys or context attributes have caused bugs.
- Many features, or several teams consuming one project.
- Flags are being retired. Archived features are left out of the generated code, so regenerating after archiving turns every call that still names one into a compile error.

Regenerate after changing definitions, and compile the application. Teams often publish the generated code as a private package from the same CI pipeline that deploys datafiles. Setting that up is project work: agree it with the user before doing it.
