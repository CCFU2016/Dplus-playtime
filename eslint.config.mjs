// ESLint: the recommended rules, with browser globals for the page sources and Node globals for scripts and tests.
import js from '@eslint/js';
import globals from 'globals';

// The build inlines these modules into the pages, where each is a global; under Node they load with require().
const inlinedModules = {
  LimitEngine: 'readonly',
  WalletDates: 'readonly',
  WalletBehaviour: 'readonly',
  WalletSettlement: 'readonly',
  WalletEccLink: 'readonly',
  WalletBrp: 'readonly',
  WalletTennet: 'readonly',
  WalletCalc: 'readonly',
  PageUI: 'readonly',
  Handoff: 'readonly',
};

export default [
  { ignores: ['dist/', 'reference/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...inlinedModules, module: 'readonly', require: 'readonly' },
    },
    rules: {
      // Each module declares its own global, which the other scripts read.
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-unused-vars': ['error', { vars: 'local' }],
    },
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
  },
];
