// The existing suites, run with `updates="every"`, must pass unchanged, render
// and evaluation counts included.
const base = require("./jest.config.js");

module.exports = {
  ...base,
  moduleNameMapper: {
    "^\\./FeaturevisorProvider(\\.js)?$": "<rootDir>/test/FeaturevisorProviderEvery.tsx",
    ...base.moduleNameMapper,
  },
  testPathIgnorePatterns: ["/node_modules/", "\\.precise\\.spec\\.tsx?$"],
};
