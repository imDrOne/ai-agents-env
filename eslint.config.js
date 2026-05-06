import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettier,
  {
    ignores: ['draft/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: [
      'src/*.js',
      'packages/*/src/**/*.js',
      'packages/dashboard/web/vite.config.js',
      'bin/agent-env-suite',
      'packages/claude-env/bin/claude-env',
      'packages/codex-env/bin/codex-env',
      'packages/dashboard/bin/agent-env-dashboard',
      'tests/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        structuredClone: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-param-reassign': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'prefer-destructuring': ['warn', { array: false, object: true }],
      'no-else-return': ['warn', { allowElseIf: false }],
      curly: ['error', 'multi-line'],
      'no-process-exit': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['packages/dashboard/web/src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        crypto: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        FileReader: 'readonly',
        window: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    rules: {
      'no-unused-vars': 'warn',
    },
  },
];
