const tsconfig = require("./tsconfig.esm.json");

/** @type import('jest').Config */
module.exports = {
  roots: ["<rootDir>"],
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", tsconfig],
  },
  testRegex: "\\.spec\\.(ts|tsx)",
  moduleFileExtensions: ["ts", "tsx", "js", "json", "node"],
  collectCoverage: false,
  bail: true,
};
