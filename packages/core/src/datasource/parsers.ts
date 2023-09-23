import { parseYaml } from "../utils";

export const parsers = {
  // extension => function
  yml(content: string) {
    return parseYaml(content);
  },

  json(content: string) {
    return JSON.parse(content);
  },
};
