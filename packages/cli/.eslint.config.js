const rootConfig = require("../../.eslintrc.js");

/** @type {import("eslint").Linter.Config} */
const config = {
  ...rootConfig,
  env: {
    node: true,
  },
};

module.exports = config;
