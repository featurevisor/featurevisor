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
    "@typescript-eslint/no-var-requires": "off",
  },
};

module.exports = config;
