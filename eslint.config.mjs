import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import esLintJs from '@eslint/js'
import typeScriptParser from '@typescript-eslint/parser'
import esLintConfigPrettier from 'eslint-config-prettier'
import pluginBoundaries from 'eslint-plugin-boundaries'
import pluginImport from 'eslint-plugin-import'
import pluginSimpleImportSort from 'eslint-plugin-simple-import-sort'
import globals from 'globals'
import typeScriptESLint from 'typescript-eslint'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const typeScriptESLintConfigBase = typeScriptESLint.configs.base
const typeScriptESLintConfigESLintRecommended = typeScriptESLint.configs.eslintRecommended
const typeScriptESLintConfigRecommended = typeScriptESLint.configs.recommended.find((recommended) => {
  if (recommended.name === 'typescript-eslint/recommended') {
    return recommended
  }
}) ?? { rules: {} }

const eslintConfig = [
  esLintConfigPrettier,
  {
    ignores: ['node_modules/**', 'dist/**', 'src/generated/**', '.git/**', '.husky/**', '.history/**', '**/.DS_Store', 'bun.lock'],
  },
  {
    name: 'for typescript',
    files: ['**/*.ts'],
    languageOptions: {
      ...typeScriptESLintConfigBase.languageOptions,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
      parser: typeScriptParser,
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: true,
      },
    },
    plugins: {
      ...typeScriptESLintConfigBase.plugins,
      boundaries: pluginBoundaries,
      import: pluginImport,
      'simple-import-sort': pluginSimpleImportSort,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
      // feature境界の判定対象（src/shared/* と src/features/* をフォルダ単位で要素化）
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/*', mode: 'folder' },
        { type: 'feature', pattern: 'src/features/*', mode: 'folder', capture: ['feature'] },
      ],
    },
    rules: {
      ...typeScriptESLintConfigESLintRecommended.rules,
      ...typeScriptESLintConfigRecommended.rules,
      indent: 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/member-delimiter-style': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
        },
      ],
      'max-classes-per-file': ['error', 2],
      'no-bitwise': [
        'error',
        {
          allow: ['~'],
        },
      ],
      'import/order': 'off',
      'sort-keys': 'off',
      'no-multiple-empty-lines': 'off',
      'lines-between-class-members': [
        'error',
        'always',
        {
          exceptAfterSingleLine: true,
        },
      ],
      'no-console': ['warn', { allow: ['info', 'error'] }],
      'spaced-comment': ['error', 'always'],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // feature独立の原則: feature間の相互importを禁止する
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              // featureから別featureへのimportを禁止（自分自身のfeatureは許可）
              from: [{ type: 'feature' }],
              disallow: [{ to: { type: 'feature', captured: { feature: '!{{ from.captured.feature }}' } } }],
              message: 'feature間のimportは禁止です。共有コードは src/shared に配置してください。',
            },
            {
              // sharedからfeatureへのimportを禁止（依存はfeature→sharedの一方向）
              from: [{ type: 'shared' }],
              disallow: [{ to: { type: 'feature' } }],
              message: 'shared から feature への import は禁止です（依存は feature→shared の一方向）。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'for mjs',
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    plugins: {
      import: pluginImport,
      'simple-import-sort': pluginSimpleImportSort,
    },
    rules: {
      ...esLintJs.configs.recommended.rules,
      indent: 'off',
      'max-classes-per-file': ['error', 2],
      'no-bitwise': [
        'error',
        {
          allow: ['~'],
        },
      ],
      'import/order': 'off',
      'sort-keys': 'off',
      'no-multiple-empty-lines': 'off',
      'lines-between-class-members': [
        'error',
        'always',
        {
          exceptAfterSingleLine: true,
        },
      ],
      'no-console': ['warn', { allow: ['info', 'error'] }],
      'spaced-comment': ['error', 'always'],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    name: 'for js',
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
  },
]

export default eslintConfig
