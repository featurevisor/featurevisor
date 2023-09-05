const rootConfig = require("../../.eslintrc.js");

/** @type {import("eslint").Linter.Config} */
const config = {
  ...rootConfig,
  rules: {
    ...rootConfig.rules,
    "@typescript-eslint/no-explicit-any": "off",
  },
};

module.exports = config;
