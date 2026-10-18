module.exports = {
  bail: true,
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      { jsc: { parser: { syntax: "typescript" } }, module: { type: "commonjs" } },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@featurevisor/sdk$": "<rootDir>/../sdk/src",
    "^@featurevisor/openfeature-provider-core$": "<rootDir>/../openfeature-provider-core/src",
  },
};
