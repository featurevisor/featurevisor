module.exports = {
  preset: "ts-jest",
  bail: true,
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
