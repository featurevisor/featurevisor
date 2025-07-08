import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  // common
  {
    ignores: [
      // directories
      "**/dist/",
      "**/datafiles/",
      "**/lib/",
      "**/coverage/",
      "**/out/",
      "tools/",

      // files
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.setup.js",
      "**/webpack*.js",
      "**/*.d.ts",

      // examples
      "**/examples/example*/plugins/",
      "**/examples/example*/src/",
    ],
  },

  // JavaScript
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
      },
      globals: globals.browser,
    },
    plugins: {
      "@eslint/js": pluginJs,
    },
    rules: {
      ...pluginJs.configs.recommended.rules,

      // custom rules
      "no-undef": "warn",
    },
  },

  // TypeScript
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
      },
      globals: globals.browser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,

      // custom rules
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
];
