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
      // レイヤー境界の判定対象（src/ 配下の各層を要素化）
      // 依存方向: routes/app/server（配線層・未要素化＝全層import可） → features → middlewares → shared → libs → utils → types
      // 配線層（routes/app.ts/server.ts）は全層importを許可するため要素化しない（未要素化のファイルは default: 'allow' で素通しになる）
      'boundaries/elements': [
        { type: 'feature', pattern: 'src/features/*', mode: 'folder', capture: ['feature'] },
        { type: 'middlewares', pattern: 'src/middlewares/**', mode: 'file' },
        { type: 'shared', pattern: 'src/shared/*', mode: 'folder' },
        { type: 'libs', pattern: 'src/libs/**', mode: 'file' },
        { type: 'utils', pattern: 'src/utils/**', mode: 'file' },
        { type: 'types', pattern: 'src/types/**', mode: 'file' },
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
      // レイヤー依存ルール: import は下方向のみ許可（上位層へのimportを禁止）
      // 層順: routes/app/server（配線層） → features → middlewares → shared → libs → utils → types
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              // feature独立の原則: featureから別featureへのimportを禁止（自分自身のfeatureは許可）
              from: [{ type: 'feature' }],
              disallow: [{ to: { type: 'feature', captured: { feature: '!{{ from.captured.feature }}' } } }],
              message: 'feature間のimportは禁止です。共有コードは src/shared に配置してください。',
            },
            {
              // middlewares は features より下位のため、features へのimportを禁止する
              from: [{ type: 'middlewares' }],
              disallow: [{ to: { type: 'feature' } }],
              message:
                'middlewares から features への import は禁止です（依存は features→middlewares の下方向）。ミドルウェアが設定した値は controller/feature 側で取り出してください。',
            },
            {
              // shared は middlewares / features より下位のため、それらへのimportを禁止する
              from: [{ type: 'shared' }],
              disallow: [{ to: { type: 'middlewares' } }, { to: { type: 'feature' } }],
              message: 'shared から middlewares / features への import は禁止です（HTTP層の関心事を shared へ持ち込まない。依存は上位→shared の下方向）。',
            },
            {
              // libs は shared / middlewares / features より下位のため、それらへのimportを禁止する
              from: [{ type: 'libs' }],
              disallow: [{ to: { type: 'shared' } }, { to: { type: 'middlewares' } }, { to: { type: 'feature' } }],
              message: 'libs から shared / middlewares / features への import は禁止です（依存は上位→libs の下方向）。',
            },
            {
              // utils は libs / shared / middlewares / features より下位のため、それらへのimportを禁止する
              from: [{ type: 'utils' }],
              disallow: [{ to: { type: 'libs' } }, { to: { type: 'shared' } }, { to: { type: 'middlewares' } }, { to: { type: 'feature' } }],
              message:
                'utils から libs / shared / middlewares / features への import は禁止です（依存は上位→utils の下方向）。libs のクライアント実体には依存しないでください。',
            },
            {
              // types は最下層のため、上位層へのimportを禁止する（型のみのimportであっても不可）
              from: [{ type: 'types' }],
              disallow: [
                { to: { type: 'utils' } },
                { to: { type: 'libs' } },
                { to: { type: 'shared' } },
                { to: { type: 'middlewares' } },
                { to: { type: 'feature' } },
              ],
              message:
                'types から上位層（utils / libs / shared / middlewares / features）への import は禁止です（types は最下層。型宣言のみを置いてください）。',
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
