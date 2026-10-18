# @featurevisor/types

Shared TypeScript types for Featurevisor definitions, datafiles and evaluation context.

## Installation

```bash
npm install @featurevisor/types
```

## Usage

Types do not validate JSON at runtime. Build datafiles with the CLI:

```ts
import type { Context, DatafileContent } from "@featurevisor/types";

const context: Context = { userId: "123", country: "nl" };
const datafile: DatafileContent = {
  schemaVersion: "4",
  revision: "example",
  features: {},
  segments: {},
};
```

See the [documentation](https://featurevisor.com/docs/sdks/javascript/).

## License

MIT © [Fahad Heylaal](https://fahad19.com)
