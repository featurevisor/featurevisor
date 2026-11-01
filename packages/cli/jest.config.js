module.exports = {
  bail: true,
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      {
        jsc: { parser: { syntax: "typescript" } },
        module: { type: "commonjs" },
      },
    ],
  },
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@featurevisor/core$": "<rootDir>/../core/src",
    "^@featurevisor/sdk$": "<rootDir>/../sdk/src",
    "^@featurevisor/parsers$": "<rootDir>/../parsers/src",
    "^@featurevisor/expressions$": "<rootDir>/../expressions/src",
  },
};
