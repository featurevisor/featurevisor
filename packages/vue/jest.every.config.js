// The existing suites, run with `updates: "every"`, must pass unchanged.
const base = require("./jest.config.js");

module.exports = {
  ...base,
  moduleNameMapper: {
    "^\\./setupApp(\\.js)?$": "<rootDir>/test/setupAppEvery.ts",
    ...base.moduleNameMapper,
  },
  testPathIgnorePatterns: ["/node_modules/", "\\.precise\\.spec\\.ts$"],
};
