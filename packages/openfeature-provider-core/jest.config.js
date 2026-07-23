module.exports = {
  bail: true,
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      { jsc: { parser: { syntax: "typescript" } }, module: { type: "commonjs" } },
    ],
  },
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
  coverageProvider: "v8",
  coverageThreshold: { global: { statements: 95, branches: 90, functions: 95, lines: 95 } },
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
};
