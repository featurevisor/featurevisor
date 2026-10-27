# @featurevisor/fel

Parser, compiler and printer for FEL, the Featurevisor Expression Language for writing `conditions` as text.

## Installation

```bash
npm install @featurevisor/fel
```

## Usage

Compile an expression into the condition tree Featurevisor builds from, and print a tree back as FEL:

```ts
import { compile, toFel } from "@featurevisor/fel";

const { conditions, errors } = compile("netherlands and plan in ['pro', 'enterprise']");
// conditions: ["netherlands", { attribute: "plan", operator: "in", value: ["pro", "enterprise"] }]
// errors: []

console.log(toFel(conditions));
// netherlands and plan in ['pro', 'enterprise']
```

Errors carry a code, a position and a hint:

```ts
compile("country = 'nl'").errors;
// [{ code: "fel_single_equals", message: "A single `=` does not compare.",
//    hint: "Use == to compare, such as country == ...", start: { line: 1, column: 9, ... }, ... }]
```

Projects opt in with `allowFEL: true` in `featurevisor.config.js`. The CLI reads FEL itself, so most projects never import this package directly.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
