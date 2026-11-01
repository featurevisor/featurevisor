# @featurevisor/expressions

Parser, compiler, printer and formatter for condition expressions: Featurevisor `conditions` written as text, such as `plan == 'pro' and seats >= 5`, instead of YAML trees.

## Installation

```bash
npm install @featurevisor/expressions
```

## Usage

Compile an expression into the condition tree Featurevisor builds from, and print a tree back as an expression:

```ts
import { compile, print } from "@featurevisor/expressions";

const { conditions, errors } = compile("netherlands and plan in ['pro', 'enterprise']");
// conditions: ["netherlands", { attribute: "plan", operator: "in", value: ["pro", "enterprise"] }]
// errors: []

console.log(print(conditions));
// netherlands and plan in ['pro', 'enterprise']
```

`treeToExpression` writes a tree as an expression only where the expression builds exactly the same tree, and `formatExpression` lays an expression out one condition a line, as `featurevisor fmt` does.

Errors carry a code, a position and a hint:

```ts
compile("country = 'nl'").errors;
// [{ code: "expression_single_equals", message: "A single `=` does not compare.",
//    hint: "Use == to compare, such as country == ...", start: { line: 1, column: 9, ... }, ... }]
```

Projects opt in with `allowConditionExpressions: true` in `featurevisor.config.js`. The CLI reads expressions itself, so most projects never import this package directly.

## License

MIT © [Fahad Heylaal](https://fahad19.com)
