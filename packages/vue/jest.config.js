module.exports = {
  preset: "ts-jest",
  bail: true,

  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["@testing-library/jest-dom/extend-expect", "./jest.setup.js"],
  moduleNameMapper: {
    "^@featurevisor/sdk$": "<rootDir>/../sdk/src",
  },
};
