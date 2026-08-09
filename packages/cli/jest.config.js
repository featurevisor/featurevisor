module.exports = {
  bail: true,
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      {
        jsc: { parser: { syntax: "typescript" } },
        module: { type: "commonjs" },
      },
    ],
  },
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
};
