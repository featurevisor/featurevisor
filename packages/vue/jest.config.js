module.exports = {
  preset: "ts-jest",
  bail: true,

  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["@testing-library/jest-dom/extend-expect", "./jest.setup.js"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@featurevisor/sdk$": "<rootDir>/../sdk/src",
    "^@vue/test-utils$": "<rootDir>/../../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js",
  },
};
