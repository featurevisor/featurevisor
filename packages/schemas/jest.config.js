module.exports = {
  bail: true,

  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["./jest.setup.js"],
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
    "^@featurevisor/sdk$": "<rootDir>/../sdk/src",
    "^@featurevisor/react$": "<rootDir>/../react/src",
    "^@featurevisor/signals$": "<rootDir>/../signals/src",
    "^@featurevisor/signals/react$": "<rootDir>/../signals/src/react",
  },
};
