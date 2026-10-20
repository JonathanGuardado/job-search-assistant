import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

const moduleBoundary = {
  group: ['@/modules/*/*'],
  message: 'Import another module only through its index: @/modules/<name> (docs/architecture.md).',
}

export default defineConfig(
  { ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts', '*.tsbuildinfo'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Read configuration through src/lib/env.ts.' },
      ],
      'no-restricted-imports': ['error', { patterns: [moduleBoundary] }],
    },
  },
  // Files at a module's root: `../` already leaves the module.
  {
    files: ['src/modules/*/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            moduleBoundary,
            { group: ['../*'], message: 'Reach other modules via @/modules/<name> and shared code via @/lib.' },
          ],
        },
      ],
    },
  },
  // Files in a module subfolder (e.g. prompts/): `../../` leaves the module.
  {
    files: ['src/modules/*/*/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            moduleBoundary,
            { group: ['../../*'], message: 'Reach other modules via @/modules/<name> and shared code via @/lib.' },
          ],
        },
      ],
    },
  },
  { files: ['src/lib/env.ts'], rules: { 'no-restricted-properties': 'off' } },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
)
