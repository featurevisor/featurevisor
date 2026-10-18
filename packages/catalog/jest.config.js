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
  },
};

module.exports = {
  bail: true,
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
