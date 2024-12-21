import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  // target
  {
    ignores: [
      // directories
      "**/dist/",
      "**/lib/",
      "**/coverage/",
      "**/out/",

      // files
      "**/*.config.js",
      "**/*.config.mjs",
      "**/.setup.js",
      "**/webpack*.js",
      "**/*.d.ts",

      // examples
      "**/examples/example*/plugins/",
      "**/examples/example*/src/",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.esm.json",
      },
      globals: globals.browser,
    },
    plugins: {
      "@eslint/js": pluginJs,
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...pluginJs.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,

      // custom overrides
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
