import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import boundaries from 'eslint-plugin-boundaries'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'storybook-static',
      'playwright-report',
      'test-results',
      'docs',
      'public/mockServiceWorker.js',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      boundaries,
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/*' },
        { type: 'pages', pattern: 'src/pages/*' },
        { type: 'widgets', pattern: 'src/widgets/*' },
        { type: 'features', pattern: 'src/features/*' },
        { type: 'entities', pattern: 'src/entities/*' },
        { type: 'shared', pattern: 'src/shared/*' },
      ],
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,

      '@typescript-eslint/no-explicit-any': 'error',

      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ['pages', 'widgets', 'features', 'entities', 'shared'] },
                  },
                },
              },
            },
            {
              from: { element: { type: 'pages' } },
              allow: {
                to: {
                  element: { types: { anyOf: ['widgets', 'features', 'entities', 'shared'] } },
                },
              },
            },
            {
              from: { element: { type: 'widgets' } },
              allow: {
                to: { element: { types: { anyOf: ['features', 'entities', 'shared'] } } },
              },
            },
            {
              from: { element: { type: 'features' } },
              allow: {
                to: { element: { types: { anyOf: ['entities', 'shared'] } } },
              },
            },
            {
              from: { element: { type: 'entities' } },
              allow: { to: { element: { type: 'shared' } } },
            },
            {
              from: { element: { type: 'shared' } },
              allow: { to: { element: { type: 'shared' } } },
            },
          ],
        },
      ],

      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'date-fns',
              message:
                'date-fns 는 함수 단위로 import 한다. 예: import { addDays } from "date-fns/addDays"',
            },
            {
              name: 'radix-ui',
              message: 'Radix 는 primitive 별 패키지로 import 한다. 예: @radix-ui/react-dialog',
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      'src/app/**/*.{ts,tsx}',
      'src/pages/**/*.{ts,tsx}',
      'src/widgets/**/*.{ts,tsx}',
      'src/features/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/shared/types/api',
                '@/shared/types/api/*',
                '**/shared/types/api',
                '**/shared/types/api/*',
              ],
              message:
                'DTO 는 entities 와 shared/mock 에서만 다룬다 (D-133). 도메인 타입은 @/entities/<name> 에서 가져온다.',
            },
          ],
        },
      ],
    },
  },

  prettier,
)
