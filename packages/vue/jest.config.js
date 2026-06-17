module.exports = {
  bail: true,

  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["@testing-library/jest-dom", "./jest.setup.js"],
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      {
        jsc: { parser: { syntax: "typescript", tsx: true } },
        module: { type: "commonjs" },
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@featurevisor/sdk$": "<rootDir>/../sdk/src",
    "^@vue/test-utils$": "<rootDir>/../../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js",
  },
};
