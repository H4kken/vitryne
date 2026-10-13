// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'pkg', 'pkg-node', 'public', 'node_modules', 'src/**/*.gen.js'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.strict, reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    // Tests index into known example data.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
