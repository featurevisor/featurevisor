const rootConfig = require("../../.eslintrc.js");

/** @type {import("eslint").Linter.Config} */
const config = {
  ...rootConfig,
  env: {
    node: true,
    browser: true,
  },
};

module.exports = config;
