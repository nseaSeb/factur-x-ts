// eslint.config.js
// Flat config. `src` is linted with type-aware rules against tsconfig.json;
// `tests` is not in that tsconfig's `include`, so it gets the syntactic rules only.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },

  js.configs.recommended,

  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Amounts, rates and line indexes are interpolated into validation
      // messages on purpose; numbers have no surprising stringification.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // A library reports through return values and thrown errors, never stdout.
      'no-console': 'error',
    },
  },

  {
    files: ['tests/**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      // Deliberate console output in tests must be opted into explicitly.
      'no-console': 'error',
    },
  },

  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      // A leading underscore marks a binding that exists only to be omitted —
      // notably the `const { x: _x, ...rest }` idiom used to drop a property.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  {
    // The config file itself is plain JS and outside every tsconfig.
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
