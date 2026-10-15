// House style lives in STYLE.md. This file enforces the parts a machine can check.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'build-test/', 'node_modules/', 'docs/', 'scripts/', 'skills/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase'] },
        // object keys mirror external formats (SARIF, hook JSON, CLI flags), leave them alone
        { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
        { selector: 'import', format: null },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-duplicate-imports': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: ['fs', 'path', 'os', 'child_process', 'readline', 'util', 'crypto', 'url'].map((name) => ({
            name,
            message: `use 'node:${name}'`,
          })),
        },
      ],
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 5],
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['test/**/*.ts'],
    // tests feed deliberately wrong values into typed APIs
    rules: { 'max-lines-per-function': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
