import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['frontend/**/*.{ts,mts}', 'tests/*.ts'],
  extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
  languageOptions: { parserOptions: { projectService: true } },
  rules: {
    curly: ['error', 'all'],
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    '@typescript-eslint/ban-ts-comment': [
      'error',
      { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false },
    ],
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
  },
});
