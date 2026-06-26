module.exports = {
  bail: true,
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      {
        jsc: { parser: { syntax: "typescript", tsx: true } },
        module: { type: "commonjs" },
      },
    ],
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coverageProvider: "v8",
  coveragePathIgnorePatterns: [
    "src/index.ts",
    "src/internal.ts",
    "src/murmurhash.ts",
    "src/compareVersions.ts",
  ],
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
