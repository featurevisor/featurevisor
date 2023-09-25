const rootConfig = require('../../prettier.config');

/** @type {import('prettier').Config} */
const config = {
  printWidth: 40,
  singleQuote: false,
  trailingComma: 'all',
  tabWidth: 2,
  semi: true,
};

module.exports = config;
