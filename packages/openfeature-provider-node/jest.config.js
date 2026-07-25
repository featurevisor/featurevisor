module.exports = {
  bail: true,
  transform: {
    "^.+\\.[tj]sx?$": [
      "@swc/jest",
      { jsc: { parser: { syntax: "typescript" } }, module: { type: "commonjs" } },
    ],
  },
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
};
