module.exports = {
  preset: "ts-jest",
  bail: true,

  // for react testing library
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["@testing-library/jest-dom/extend-expect", "./jest.setup.js"],
};
