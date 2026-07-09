/**
 * Shared ESLint preset (legacy .eslintrc style) for V-AEP.
 *
 * Kept dependency-light: extends eslint:recommended only. Apps that want
 * TypeScript-aware linting layer @typescript-eslint on top of this in their
 * own .eslintrc (those deps are intentionally not required by the base slice).
 */
module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  extends: ['eslint:recommended'],
  ignorePatterns: ['dist/', '.next/', 'node_modules/', 'coverage/', '*.cjs'],
  rules: {
    'no-unused-vars': 'off',
    'no-undef': 'off',
  },
};
