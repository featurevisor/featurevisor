module.exports = {
  preset: "ts-jest",

  // for react testing library
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["@testing-library/jest-dom/extend-expect"],
};
