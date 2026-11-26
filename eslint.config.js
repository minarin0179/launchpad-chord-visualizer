import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** 名前を付けなくても意味が明らかな数値 */
const OBVIOUS_NUMBERS = [-1, 0, 1, 2];

/** 層ごとの import 制限（下位層が上位層を参照しないことを保証する） */
const layer = (files, patterns, message) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }],
  },
});

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'packages/**',
      'tests/golden/**',
      // リライト前の旧アプリ（切り替え時に削除する）
      'js/**',
      'scripts/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json', './tsconfig.worker.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration > VariableDeclaration[kind="let"]',
          message:
            'export let は使わない（ライブバインディングは暗黙の共有状態になる）。ストアか関数で公開する。',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: OBVIOUS_NUMBERS,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreClassFieldInitialValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
        },
      ],
    },
  },
  {
    // 定数の定義場所・テスト・DSP の数式では数値リテラルを許可する
    files: [
      'src/config/**',
      'src/core/theory.ts',
      'src/core/key.ts',
      'src/song/sources/songle-chord.ts',
      'src/analyzer/constants.ts',
      'src/analyzer/dsp.ts',
      '**/*.test.ts',
      'tests/**',
      '*.config.{ts,js}',
    ],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },
  {
    files: ['**/*.test.ts', 'tests/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  layer(
    ['src/core/**'],
    ['../*', '!../core', 'launchpad-x'],
    'core は core の中だけを import する（DOM・デバイス・設定に依存しない純粋層）。',
  ),
  layer(
    ['src/store/**'],
    ['../ui/*', '../platform/*', '../audio/*', '../midi/*', '../led/*', '../app/*', 'launchpad-x'],
    'store は core / config / song の純粋部分だけを import する。',
  ),
  {
    // DOM・ストレージに触れてよいのは境界の層だけ
    files: ['src/core/**', 'src/store/**', 'src/config/**', 'src/analyzer/**', 'src/led/frame.ts'],
    ignores: ['**/*.worker.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['document', 'window', 'localStorage', 'navigator'].map((name) => ({
          name,
          message: 'この層は DOM / ブラウザ API に依存しない。',
        })),
      ],
    },
  },
  {
    files: ['*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
