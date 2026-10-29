# @featurevisor/parsers

YAML and JSON parsers for reading, writing and formatting Featurevisor definitions, with a TypeScript contract for custom parsers.

## Installation

```bash
npm install @featurevisor/parsers
```

## Usage

Custom parsers provide both `parse` and `stringify`. For `featurevisor fmt`, a parser can also give an optional `format(source, layout)`, which lays out a file with the `FormatLayout` Featurevisor passes it, and an optional `listComments(source)`, so fmt can check that formatting kept every comment. Use a built in parser directly:

```ts
import { parsers } from "@featurevisor/parsers";

const definition = parsers.yml.parse<{ description: string }>(
  "description: Checkout configuration",
);
console.log(parsers.json.stringify(definition));
```

See the [documentation](https://featurevisor.com/docs/advanced/custom-parsers/).

## License

MIT © [Fahad Heylaal](https://fahad19.com)
