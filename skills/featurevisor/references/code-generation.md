# Code generation

Full docs: <https://featurevisor.com/docs/code-generation>

Generate type-safe TypeScript bindings from your feature definitions so applications get autocomplete and compile-time checks on feature keys, variable keys, variable types, and context attribute types.

Currently TypeScript only. Other languages are planned as more SDKs mature.

## Generate

```bash
npx featurevisor generate-code --language typescript --out-dir ./src
```

Optional flags:

| Flag                       | Effect                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| `--tag=<tag>`              | Generate for one tag's features only (matches a deployed bundle)         |
| `--react`                  | Also emit typed React hooks (`useFlag`, `useVariation`, `useVariable`)   |
| `--no-individual-features` | Skip per-feature `*Feature.ts` modules; only emit the function-style API |

## Output

Inside `--out-dir`:

- `context.ts` — typed `Context` interface built from all attribute definitions.
- `attributes.ts` — typed per-attribute types (`CountryAttribute`, `UserIdAttribute`, etc.).
- `schemas.ts` — reusable schema types from `schemas/`.
- `index.ts` — barrel exports for the function API (`isEnabled`, `getVariation`, `getVariable`, plus `setInstance`).
- `<FeatureName>Feature.ts` — per-feature namespaces (unless `--no-individual-features`).
- `React.ts` — typed hooks (only with `--react`).

## Wiring into an application

```ts
import { createFeaturevisor } from '@featurevisor/sdk'
import { setInstance, isEnabled, getVariation, getVariable } from '@yourorg/features'

const f = createFeaturevisor({ datafile })
setInstance(f)

// from here on, calls are type-checked
const ok = isEnabled('checkout/express')                // wrong key → TS error
const v  = getVariation('sidebar', { userId: 'u_1' })   // wrong context attribute type → TS error
const c  = getVariable('sidebar', 'color')              // wrong variable key for this feature → TS error
```

React hooks (if generated):

```tsx
import { useFlag, useVariation, useVariable } from '@yourorg/features'

const show = useFlag('checkout/express')
const v    = useVariation('sidebar')
const color = useVariable('sidebar', 'color')
```

## Publishing

Common pattern: publish the generated code as a private npm package (e.g. `@yourorg/features`) from the same CI pipeline that builds and deploys datafiles. ESM build enables tree-shaking on the consumer side.

The skill does not author the npm package itself — that's project setup work; defer to the user.

## When the agent should suggest code-gen

- The user is consuming features from TypeScript and asks "how do I avoid string-typing feature keys?"
- The user is rolling out a new attribute and worries about wrong-type context payloads.
- The user manages many features and reports churn from typo-driven bugs.

For SDK usage in JS/TS _without_ code-gen, just point at <https://featurevisor.com/docs/sdks/javascript>.
