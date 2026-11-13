const common = {
  rootDir: __dirname,
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          transform: { react: { runtime: "automatic" } },
        },
        module: { type: "commonjs" },
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // workspace siblings from source, so a stale build cannot pass the tests
    "^@featurevisor/expressions$": "<rootDir>/../expressions/src/index.ts",
  },
};

module.exports = {
  bail: true,
  globalSetup: "<rootDir>/jest.timezone.setup.js",
  projects: [
    {
      ...common,
      displayName: "unit",
      testPathIgnorePatterns: ["/node_modules/", "\\.filesystem\\.spec\\.ts$"],
    },
    {
      ...common,
      displayName: "filesystem",
      testMatch: ["<rootDir>/src/**/*.filesystem.spec.ts"],
      runner: "<rootDir>/jest.serial-runner.cjs",
    },
  ],
};
