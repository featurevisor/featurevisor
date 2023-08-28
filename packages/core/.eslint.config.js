const rootConfig = require("../../.eslintrc.js");

/** @type {import("eslint").Linter.Config} */
const config = {
  ...rootConfig,
  env: {
    node: true,
    commonjs: true,
  },
};

module.exports = config;
