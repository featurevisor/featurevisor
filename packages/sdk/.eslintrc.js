const rootConfig = require("../../.eslintrc.js");

/** @type {import("eslint").Linter.Config} */
const config = {
  ...rootConfig,
  env: {
    node: true,
  },
  rules: {
    ...rootConfig.rules,
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/ban-types": [
      "off",
      {
        Function: false,
      },
    ],
  },
};

module.exports = config;
