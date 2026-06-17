module.exports = {
  preset: "ts-jest",
  bail: true,
  collectCoverageFrom: ["src/**/*.ts"],
  coveragePathIgnorePatterns: ["src/index.ts", "src/murmurhash.ts", "src/compareVersions.ts"],
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 90,
      functions: 99,
      lines: 95,
    },
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
