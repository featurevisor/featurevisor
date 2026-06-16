module.exports = {
  preset: "ts-jest",
  bail: true,
  collectCoverageFrom: ["src/**/*.ts"],
  coveragePathIgnorePatterns: ["src/index.ts", "src/murmurhash.ts", "src/compareVersions.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
