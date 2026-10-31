// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url)));

export default tseslint.config(
  {
    ignores: [
      "dist",
      "pkg",
      "pkg-node",
      "public",
      "node_modules",
      "src/**/*.gen.js",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strict,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    // One component per file (packages/vitryne-docs/content/docs/developers/architecture.mdx, "Files"); shadcn's generated ones excepted.
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/**"],
    plugins: { react },
    // "detect" calls an API ESLint 10 removed; the version from package.json instead.
    settings: { react: { version: pkg.dependencies.react } },
    rules: { "react/no-multi-comp": ["error", { ignoreStateless: false }] },
  },
  {
    // Tests index into known example data.
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
