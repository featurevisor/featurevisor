import * as YAML from "yaml";

import type { CustomParser } from "./index";

export const ymlParser: CustomParser = {
  extension: "yml",
  parse: function <T>(content: string): T {
    return YAML.parse(content) as T;
  },
  stringify: function (content: any) {
    return YAML.stringify(content);
  },
};
