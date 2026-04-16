module.exports = {
  preset: "ts-jest",
  bail: true,
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.cjs.json",
      },
    ],
  },
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
};
