import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'build/**', 'release/**', 'node_modules/**', '*.mjs', '.test-build/**', 'test/bundle.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-cond-assign': ['error', 'except-parens'],
      'no-useless-assignment': 'warn',
      'prefer-const': 'warn',
      'no-case-declarations': 'off',
    },
  },
);
