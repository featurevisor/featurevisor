module.exports = {
  bail: true,

  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["./jest.setup.js"],
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          transform: { react: { runtime: "automatic" } },
        },
        module: { type: "commonjs" },
      },
    ],
  },
  // signal-polyfill is ESM only, and jsdom resolves Preact signals to ESM too.
  transformIgnorePatterns: ["/node_modules/(?!(signal-polyfill|@preact/signals-core)/)"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@featurevisor/sdk$": "<rootDir>/../sdk/src",
    "^@vue/test-utils$": "<rootDir>/../../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js",
  },
};
