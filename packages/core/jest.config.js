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
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.spec.ts"],
  coverageThreshold: {
    global: {
      statements: 58,
      branches: 59,
      functions: 63,
      lines: 59,
    },
  },
};
