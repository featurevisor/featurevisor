const tsconfig = require("./tsconfig.esm.json");

module.exports = {
  roots: ["<rootDir>"],
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", tsconfig],
  },
  testRegex: "\\.spec\\.(ts|tsx)",
  moduleFileExtensions: ["ts", "tsx", "js", "json", "node"],
  collectCoverage: false,
  bail: true,

  // for react testing library
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["@testing-library/jest-dom/extend-expect"],
};
